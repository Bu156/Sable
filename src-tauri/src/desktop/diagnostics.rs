use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use regex::Regex;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const DEFAULT_ARCHIVE_NAME: &str = "sable-diagnostics.zip";
const MAX_LOG_FILES: usize = 6;

#[tauri::command]
pub fn export_diagnostics(
    app: AppHandle<crate::BrowserEngine>,
    frontend_logs: Option<String>,
) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(DEFAULT_ARCHIVE_NAME)
        .add_filter("ZIP archive", &["zip"])
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let archive_path = path.into_path().map_err(|err| err.to_string())?;
    validate_zip_extension(&archive_path).map_err(|err| err.to_string())?;
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    let system_info = system_info(
        &app.package_info().version.to_string(),
        std::env::consts::OS,
        std::env::consts::ARCH,
    );

    create_archive(
        &archive_path,
        &log_dir,
        &system_info,
        frontend_logs.as_deref(),
    )
    .map_err(|err| err.to_string())?;

    Ok(Some(format!(
        "Diagnostics exported to {}",
        archive_path.display()
    )))
}

fn validate_zip_extension(path: &Path) -> io::Result<()> {
    let is_zip = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));
    if !is_zip {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Diagnostics destination must have a .zip extension",
        ));
    }
    Ok(())
}

fn system_info(version: &str, os: &str, architecture: &str) -> String {
    format!("Sable diagnostics\nApp version: {version}\nOS: {os}\nArchitecture: {architecture}\n")
}
fn sensitive_paths() -> Vec<PathBuf> {
    let mut paths = vec![std::env::temp_dir()];
    for variable in ["HOME", "USERPROFILE"] {
        if let Some(path) = std::env::var_os(variable).map(PathBuf::from) {
            paths.push(path);
        }
    }
    paths
}
fn replace_pattern(text: String, pattern: &str, replacement: &str) -> String {
    Regex::new(pattern)
        .expect("diagnostics redaction pattern must be valid")
        .replace_all(&text, replacement)
        .into_owned()
}
fn redact_text_with_paths(text: &str, paths: &[PathBuf]) -> String {
    let mut sanitized = replace_pattern(
        text.to_owned(),
        r#"(?i)\b[a-z][a-z0-9+.-]{1,15}://[^\s<>\"']+"#,
        "[REDACTED_URL]",
    );
    sanitized = replace_pattern(
        sanitized,
        r#"(?i)\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+"#,
        "[REDACTED_CREDENTIAL]",
    );
    sanitized = replace_pattern(
        sanitized,
        r#"(?i)([\"']?(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|access[-_]?token|refresh[-_]?token|id[-_]?token|x[-_]?auth[-_]?token|x[-_]?access[-_]?token|api[-_]?key|client[-_]?secret|password|passwd|secret|credential|token)[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;}\]]+)"#,
        "$1[REDACTED]",
    );
    sanitized = replace_pattern(
        sanitized,
        r#"@[A-Za-z0-9._=/\\-]+:(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(?::[0-9]+)?"#,
        "[REDACTED_MATRIX_USER_ID]",
    );
    sanitized = replace_pattern(
        sanitized,
        r#"[!#][A-Za-z0-9._=/\\-]+:(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(?::[0-9]+)?"#,
        "[REDACTED_MATRIX_ROOM_ID]",
    );
    sanitized = replace_pattern(
        sanitized,
        r#"\$[A-Za-z0-9._~=/\\-]+(?::(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(?::[0-9]+)?)?"#,
        "[REDACTED_MATRIX_EVENT_ID]",
    );
    let mut path_strings = paths
        .iter()
        .filter(|path| path.is_absolute())
        .map(|path| path.to_string_lossy().into_owned())
        .filter(|path| path.len() > 1)
        .collect::<Vec<_>>();
    path_strings.sort_by_key(|path| std::cmp::Reverse(path.len()));
    for path in path_strings {
        sanitized = sanitized.replace(&path, "[REDACTED_PATH]");
    }
    sanitized
}
fn redact_text(text: &str) -> String {
    redact_text_with_paths(text, &sensitive_paths())
}
fn is_sensitive_json_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxyauthorization"
            | "cookie"
            | "setcookie"
            | "token"
            | "accesstoken"
            | "refreshtoken"
            | "idtoken"
            | "xauthtoken"
            | "xaccesstoken"
            | "apikey"
            | "clientsecret"
            | "password"
            | "passwd"
            | "secret"
            | "credential"
            | "credentials"
            | "deviceid"
            | "sessionid"
    ) || normalized.ends_with("token")
        || normalized.ends_with("secret")
        || normalized.ends_with("password")
}
fn sanitize_headers(value: &Value, paths: &[PathBuf]) -> Value {
    match value {
        Value::Object(headers) => Value::Object(
            headers
                .keys()
                .map(|key| (key.clone(), Value::String("[REDACTED]".into())))
                .collect(),
        ),
        Value::Array(headers) => Value::Array(
            headers
                .iter()
                .map(|header| match header {
                    Value::Array(pair) if pair.len() >= 2 => Value::Array(vec![
                        Value::String(redact_text_with_paths(
                            pair.first().and_then(Value::as_str).unwrap_or("header"),
                            paths,
                        )),
                        Value::String("[REDACTED]".into()),
                    ]),
                    _ => sanitize_json_value(header, paths).unwrap_or(Value::Null),
                })
                .collect(),
        ),
        _ => sanitize_json_value(value, paths).unwrap_or(Value::Null),
    }
}
fn sanitize_json_value(value: &Value, paths: &[PathBuf]) -> Option<Value> {
    match value {
        Value::Object(object) => {
            let mut sanitized = Map::new();
            for (key, value) in object {
                if key.eq_ignore_ascii_case("data") {
                    continue;
                }
                let value = if key.eq_ignore_ascii_case("headers") {
                    sanitize_headers(value, paths)
                } else if is_sensitive_json_key(key) {
                    Value::String("[REDACTED]".into())
                } else {
                    sanitize_json_value(value, paths)?
                };
                sanitized.insert(key.clone(), value);
            }
            Some(Value::Object(sanitized))
        }
        Value::Array(array) => Some(Value::Array(
            array
                .iter()
                .filter_map(|value| sanitize_json_value(value, paths))
                .collect(),
        )),
        Value::String(string) => Some(Value::String(redact_text_with_paths(string, paths))),
        Value::Null | Value::Bool(_) | Value::Number(_) => Some(value.clone()),
    }
}

fn sanitized_frontend_logs(serialized: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(serialized).ok()?;
    if value.is_null() {
        return None;
    }
    let sanitized = sanitize_json_value(&value, &sensitive_paths())?;
    serde_json::to_string_pretty(&sanitized).ok()
}

fn recent_log_files(log_dir: &Path) -> io::Result<Vec<PathBuf>> {
    if !log_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files = fs::read_dir(log_dir)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file()
                || entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str())
                    != Some("log")
            {
                return None;
            }

            Some(entry.path())
        })
        .collect::<Vec<_>>();

    files.sort_by(|left, right| {
        let left_modified = fs::metadata(left)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let right_modified = fs::metadata(right)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        right_modified
            .cmp(&left_modified)
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });
    files.truncate(MAX_LOG_FILES);
    Ok(files)
}

fn create_archive(
    archive_path: &Path,
    log_dir: &Path,
    system_info: &str,
    frontend_logs: Option<&str>,
) -> io::Result<()> {
    let temporary_path = temporary_archive_path(archive_path)?;
    let result = write_archive(
        &temporary_path,
        log_dir,
        system_info,
        frontend_logs.and_then(sanitized_frontend_logs),
    );
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary_path, archive_path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }
    Ok(())
}

fn temporary_archive_path(archive_path: &Path) -> io::Result<PathBuf> {
    let file_name = archive_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Invalid archive filename"))?;
    let suffix = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    Ok(archive_path.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        suffix
    )))
}

fn write_archive(
    archive_path: &Path,
    log_dir: &Path,
    system_info: &str,
    frontend_logs: Option<String>,
) -> io::Result<()> {
    let archive = File::create(archive_path)?;
    let mut writer = ZipWriter::new(archive);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for log_path in recent_log_files(log_dir)? {
        let Some(file_name) = log_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        let Ok(log_contents) = fs::read_to_string(&log_path) else {
            continue;
        };
        let sanitized_log = redact_text(&log_contents);
        writer
            .start_file(format!("logs/{file_name}"), options)
            .map_err(io::Error::other)?;
        writer.write_all(sanitized_log.as_bytes())?;
    }

    writer
        .start_file("system-info.txt", options)
        .map_err(io::Error::other)?;
    writer.write_all(system_info.as_bytes())?;
    if let Some(frontend_logs) = frontend_logs {
        writer
            .start_file("logs/frontend-debug-logs.json", options)
            .map_err(io::Error::other)?;
        writer.write_all(frontend_logs.as_bytes())?;
    }
    writer.finish().map_err(io::Error::other)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{create_archive, system_info, validate_zip_extension};
    use serde_json::json;
    use std::fs::{self, File};
    use std::io::Read;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TemporaryDirectory(PathBuf);

    impl Drop for TemporaryDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temporary_directory() -> TemporaryDirectory {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time must be after the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "sable-diagnostics-test-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir(&path).expect("temporary diagnostics directory should be creatable");
        TemporaryDirectory(path)
    }

    #[test]
    fn system_info_contains_only_requested_fields() {
        assert_eq!(
            system_info("1.2.3", "linux", "x86_64"),
            "Sable diagnostics\nApp version: 1.2.3\nOS: linux\nArchitecture: x86_64\n"
        );
    }

    #[test]
    fn zip_extension_is_required() {
        assert!(validate_zip_extension(Path::new("support.zip")).is_ok());
        assert!(validate_zip_extension(Path::new("support.ZIP")).is_ok());
        let error = validate_zip_extension(Path::new("support.tar")).unwrap_err();
        assert_eq!(
            error.to_string(),
            "Diagnostics destination must have a .zip extension"
        );
    }

    #[test]
    fn create_archive_contains_system_info_and_recent_log() {
        let temporary_directory = temporary_directory();
        let log_path = temporary_directory.0.join("sable.log");
        let archive_path = temporary_directory.0.join("diagnostics.zip");
        fs::write(&log_path, "native log entry\n").expect("log should be writable");

        create_archive(
            &archive_path,
            &temporary_directory.0,
            "Sable diagnostics\nApp version: 1.2.3\nOS: linux\nArchitecture: x86_64\n",
            None,
        )
        .expect("diagnostics archive should be created");
        let archive_entries = fs::read_dir(&temporary_directory.0)
            .expect("temporary directory should be readable")
            .map(|entry| entry.expect("archive entry should be readable").file_name())
            .collect::<Vec<_>>();
        assert!(archive_entries
            .iter()
            .all(|entry| !entry.to_string_lossy().starts_with('.')));

        let archive_file = File::open(archive_path).expect("archive should be readable");
        let mut archive = zip::ZipArchive::new(archive_file).expect("archive should be valid ZIP");

        let mut log = archive
            .by_name("logs/sable.log")
            .expect("qualifying log should be archived");
        let mut log_contents = String::new();
        log.read_to_string(&mut log_contents)
            .expect("archived log should be readable");
        assert_eq!(log_contents, "native log entry\n");
        drop(log);

        let mut system_info = archive
            .by_name("system-info.txt")
            .expect("system info should be archived");
        let mut system_info_contents = String::new();
        system_info
            .read_to_string(&mut system_info_contents)
            .expect("system info should be readable");
        assert_eq!(
            system_info_contents,
            "Sable diagnostics\nApp version: 1.2.3\nOS: linux\nArchitecture: x86_64\n"
        );
    }

    #[test]
    fn create_archive_redacts_native_and_frontend_sensitive_content() {
        let temporary_directory = temporary_directory();
        let archive_path = temporary_directory.0.join("diagnostics.zip");
        let home_path = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("sable-private");
        let native_log = format!(
            "timestamp=2026-07-27T12:00:00Z level=INFO category=safe-category token=native-token Authorization: Bearer native-bearer-token @alice:example.org !room-secret:example.org $event-secret:example.org https://matrix.example/_matrix/client?access_token=url-secret#fragment {} {}",
            home_path.display(),
            temporary_directory.0.join("native-secret.txt").display()
        );
        fs::write(temporary_directory.0.join("sable.log"), native_log)
            .expect("native log should be writable");
        let frontend_logs = serde_json::to_string(&json!([{
            "timestamp": "2026-07-27T12:01:00Z",
            "level": "WARN",
            "namespace": "frontend-namespace",
            "message": format!(
                "accessToken=frontend-token @bob:example.org https://example.org/path?token=frontend-url-secret#fragment {}",
                home_path.display()
            ),
            "data": { "raw": "frontend-data-secret" },
            "headers": {
                "authorization": "frontend-header-secret",
                "content-type": "application/json"
            }
        }]))
        .expect("frontend logs should serialize");

        create_archive(
            &archive_path,
            &temporary_directory.0,
            "Sable diagnostics\nApp version: 1.2.3\nOS: linux\nArchitecture: x86_64\n",
            Some(&frontend_logs),
        )
        .expect("diagnostics archive should be created");

        let archive_file = File::open(archive_path).expect("archive should be readable");
        let mut archive = zip::ZipArchive::new(archive_file).expect("archive should be valid ZIP");
        let mut native = String::new();
        archive
            .by_name("logs/sable.log")
            .expect("native log should be archived")
            .read_to_string(&mut native)
            .expect("sanitized native log should be readable");
        let mut frontend = String::new();
        archive
            .by_name("logs/frontend-debug-logs.json")
            .expect("frontend logs should be archived")
            .read_to_string(&mut frontend)
            .expect("sanitized frontend logs should be readable");

        for forbidden in [
            "native-token",
            "native-bearer-token",
            "frontend-token",
            "frontend-data-secret",
            "frontend-header-secret",
            "url-secret",
            "frontend-url-secret",
            "@alice:example.org",
            "@bob:example.org",
            "!room-secret:example.org",
            "$event-secret:example.org",
            "https://matrix.example",
            "https://example.org",
            home_path.to_str().unwrap_or("sable-private"),
            temporary_directory
                .0
                .to_str()
                .unwrap_or("sable-diagnostics-test"),
        ] {
            assert!(!native.contains(forbidden), "native log leaked {forbidden}");
            assert!(
                !frontend.contains(forbidden),
                "frontend logs leaked {forbidden}"
            );
        }
        assert!(native.contains("safe-category"));
        assert!(frontend.contains("frontend-namespace"));
        assert!(frontend.contains("WARN"));
        assert!(!frontend.contains("\"data\""));
    }

    #[test]
    fn malformed_frontend_payload_is_excluded() {
        let temporary_directory = temporary_directory();
        let archive_path = temporary_directory.0.join("diagnostics.zip");

        create_archive(
            &archive_path,
            &temporary_directory.0,
            "Sable diagnostics\nApp version: 1.2.3\nOS: linux\nArchitecture: x86_64\n",
            Some("not valid JSON"),
        )
        .expect("diagnostics archive should still be created");

        let archive_file = File::open(archive_path).expect("archive should be readable");
        let mut archive = zip::ZipArchive::new(archive_file).expect("archive should be valid ZIP");
        assert!(archive.by_name("logs/frontend-debug-logs.json").is_err());
    }

    #[test]
    fn failed_atomic_rename_cleans_up_temporary_archive() {
        let temporary_directory = temporary_directory();
        let destination = temporary_directory.0.join("existing-directory.zip");
        fs::create_dir(&destination).expect("destination directory should be creatable");

        assert!(create_archive(
            &destination,
            &temporary_directory.0,
            "Sable diagnostics\nApp version: 1.2.3\nOS: linux\nArchitecture: x86_64\n",
            None,
        )
        .is_err());
        let entries = fs::read_dir(&temporary_directory.0)
            .expect("temporary directory should be readable")
            .map(|entry| entry.expect("archive entry should be readable").file_name())
            .collect::<Vec<_>>();
        assert_eq!(entries, vec![PathBuf::from("existing-directory.zip")]);
    }
}
