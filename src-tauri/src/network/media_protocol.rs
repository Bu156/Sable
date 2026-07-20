use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{OnceLock, RwLock},
    time::Duration,
};

use sha2::{Digest, Sha256};
use tauri::{
    http::{header, response::Builder as ResponseBuilder, Request, Response, StatusCode, Uri},
    AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder,
};
use tauri_plugin_http::reqwest::{
    header::{AUTHORIZATION, CONTENT_TYPE},
    Client, Url,
};
use tokio::sync::Semaphore;

pub const MEDIA_URI_SCHEME: &str = "sable-media";

const MEDIA_PATH_PREFIXES: [&str; 2] = ["/_matrix/media/", "/_matrix/client/v1/media/"];
const CACHE_SUBDIR: &str = "sable-media";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CONCURRENT_REQUESTS: usize = 8;
const MAX_CACHE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_RANGE_CHUNK: u64 = 2 * 1024 * 1024;

pub struct MediaSessionState {
    inner: RwLock<Option<MediaSession>>,
    client: OnceLock<Client>,
    semaphore: Semaphore,
}

impl Default for MediaSessionState {
    fn default() -> Self {
        Self {
            inner: RwLock::new(None),
            client: OnceLock::new(),
            semaphore: Semaphore::new(MAX_CONCURRENT_REQUESTS),
        }
    }
}

impl MediaSessionState {
    // Shared across requests so the connection pool and TLS sessions stay warm.
    fn client(&self) -> Client {
        self.client
            .get_or_init(|| {
                Client::builder()
                    .timeout(REQUEST_TIMEOUT)
                    .connect_timeout(CONNECT_TIMEOUT)
                    .build()
                    .unwrap_or_else(|_| Client::new())
            })
            .clone()
    }
}

#[derive(Clone)]
struct MediaSession {
    origin: String,
    token: String,
}

#[tauri::command]
pub fn set_media_session(
    state: tauri::State<'_, MediaSessionState>,
    base_url: String,
    token: String,
) -> Result<(), String> {
    let origin = Url::parse(&base_url)
        .map_err(|err| err.to_string())?
        .origin()
        .ascii_serialization();

    let mut guard = state
        .inner
        .write()
        .map_err(|_| "media session lock poisoned".to_string())?;
    *guard = Some(MediaSession { origin, token });
    Ok(())
}

#[tauri::command]
pub fn clear_media_session<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, MediaSessionState>,
) {
    if let Ok(mut guard) = state.inner.write() {
        *guard = None;
    }
    if let Ok(dir) = cache_dir(&app) {
        let _ = fs::remove_dir_all(dir);
    }
}

pub fn respond<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let uri = request.uri().clone();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    tauri::async_runtime::spawn(async move {
        let response = handle_request(&app, uri, range)
            .await
            .unwrap_or_else(error_response);
        responder.respond(response);
    });
}

async fn handle_request<R: Runtime>(
    app: &AppHandle<R>,
    uri: Uri,
    range: Option<String>,
) -> Result<Response<Vec<u8>>, StatusCode> {
    let target = percent_encoding::percent_decode_str(uri.path().trim_start_matches('/'))
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?
        .into_owned();

    let session = {
        let state = app.state::<MediaSessionState>();
        let guard = state
            .inner
            .read()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        guard.clone().ok_or(StatusCode::UNAUTHORIZED)?
    };

    let media_url = Url::parse(&target).map_err(|_| StatusCode::BAD_REQUEST)?;
    if media_url.scheme() != "http" && media_url.scheme() != "https" {
        return Err(StatusCode::FORBIDDEN);
    }
    if media_url.origin().ascii_serialization() != session.origin {
        return Err(StatusCode::FORBIDDEN);
    }
    if !MEDIA_PATH_PREFIXES
        .iter()
        .any(|prefix| media_url.path().starts_with(prefix))
    {
        return Err(StatusCode::FORBIDDEN);
    }

    let key = cache_key(&session.token, &target);
    let dir = cache_dir(app).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let body_path = dir.join(&key);
    let content_type_path = dir.join(format!("{key}.ct"));

    let state = app.state::<MediaSessionState>();
    let _permit = state
        .semaphore
        .acquire()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Cache to disk first, then serve from there so Range works regardless of
    // homeserver support. Files larger than the cache budget are served from
    // memory for this request and never persisted, so evict_if_needed can't
    // drop them on write.
    let (content_type, in_memory_body) = ensure_cached(
        &state,
        &session,
        media_url,
        dir,
        body_path.clone(),
        content_type_path,
    )
    .await?;

    match (range, in_memory_body) {
        (Some(range_header), Some(body)) => {
            Ok(serve_range_memory(body, &content_type, &range_header))
        }
        (Some(range_header), None) => serve_range(body_path, content_type, range_header).await,
        (None, Some(body)) => Ok(ok_response(body, &content_type)),
        (None, None) => Ok(ok_response(read_full(body_path).await?, &content_type)),
    }
}

// Ensure the body + content type are on disk, fetching from the homeserver on a miss.
async fn ensure_cached(
    state: &MediaSessionState,
    session: &MediaSession,
    media_url: Url,
    dir: PathBuf,
    body_path: PathBuf,
    content_type_path: PathBuf,
) -> Result<(String, Option<Vec<u8>>), StatusCode> {
    if let Some(content_type) =
        read_content_type(body_path.clone(), content_type_path.clone()).await
    {
        return Ok((content_type, None));
    }

    let upstream = state
        .client()
        .get(media_url)
        .header(AUTHORIZATION, format!("Bearer {}", session.token))
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    if !upstream.status().is_success() {
        return Err(
            StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY)
        );
    }

    let content_type = upstream
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let body = upstream
        .bytes()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?
        .to_vec();

    if fits_in_cache(body.len() as u64) {
        write_cache(
            dir,
            body_path,
            content_type_path,
            body,
            content_type.clone(),
        )
        .await;
        Ok((content_type, None))
    } else {
        Ok((content_type, Some(body)))
    }
}

fn fits_in_cache(len: u64) -> bool {
    len <= MAX_CACHE_BYTES
}

// Only a hit when the body file is also present, so a stray `.ct` counts as a miss.
async fn read_content_type(body_path: PathBuf, content_type_path: PathBuf) -> Option<String> {
    tokio::task::spawn_blocking(move || {
        if !body_path.is_file() {
            return None;
        }
        fs::read_to_string(&content_type_path).ok()
    })
    .await
    .unwrap_or(None)
}

async fn read_full(body_path: PathBuf) -> Result<Vec<u8>, StatusCode> {
    tokio::task::spawn_blocking(move || fs::read(&body_path))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn serve_range(
    body_path: PathBuf,
    content_type: String,
    range_header: String,
) -> Result<Response<Vec<u8>>, StatusCode> {
    tokio::task::spawn_blocking(move || {
        let mut file = fs::File::open(&body_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let total = file
            .metadata()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .len();

        let Some((start, end)) = parse_range(&range_header, total) else {
            return Ok(range_not_satisfiable(total));
        };

        let end = end.min(start + MAX_RANGE_CHUNK - 1);
        let length = end - start + 1;

        let mut buf = vec![0_u8; length as usize];
        file.seek(SeekFrom::Start(start))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        file.read_exact(&mut buf)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(partial_response(buf, &content_type, start, end, total))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

// Serve a Range request from an in-memory body. Mirrors serve_range but slices
// the buffer instead of seeking.
fn serve_range_memory(body: Vec<u8>, content_type: &str, range_header: &str) -> Response<Vec<u8>> {
    let total = body.len() as u64;
    let Some((start, end)) = parse_range(range_header, total) else {
        return range_not_satisfiable(total);
    };
    let end = end.min(start + MAX_RANGE_CHUNK - 1);
    let buf = body[start as usize..=(end as usize)].to_vec();
    partial_response(buf, content_type, start, end, total)
}

// First byte range of a `Range: bytes=...` header as inclusive (start, end); None → 416.
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }

    let spec = header.strip_prefix("bytes=")?;
    let (start_str, end_str) = spec.split(',').next()?.trim().split_once('-')?;

    let (start, end) = if start_str.is_empty() {
        let suffix: u64 = end_str.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        (total.saturating_sub(suffix), total - 1)
    } else {
        let start: u64 = start_str.parse().ok()?;
        let end = if end_str.is_empty() {
            total - 1
        } else {
            end_str.parse::<u64>().ok()?.min(total - 1)
        };
        (start, end)
    };

    if start > end || start >= total {
        return None;
    }
    Some((start, end))
}

async fn write_cache(
    dir: PathBuf,
    body_path: PathBuf,
    content_type_path: PathBuf,
    body: Vec<u8>,
    content_type: String,
) {
    let _ = tokio::task::spawn_blocking(move || {
        if fs::create_dir_all(&dir).is_ok() {
            let _ = fs::write(&body_path, &body);
            let _ = fs::write(&content_type_path, &content_type);
            evict_if_needed(&dir);
        }
    })
    .await;
}

// Trim oldest-first when the cache exceeds its byte budget.
fn evict_if_needed(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            Some((path, meta.len(), modified))
        })
        .collect();

    let mut total: u64 = files.iter().map(|(_, len, _)| *len).sum();
    if total <= MAX_CACHE_BYTES {
        return;
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, len, _) in files {
        if total <= MAX_CACHE_BYTES {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

// Shared 200/206 headers. Media is content-addressed and the URL is session-scoped, so
// it is safe to let the webview cache it as immutable and to advertise Range support.
fn media_response_builder(status: StatusCode, content_type: &str) -> ResponseBuilder {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(
            header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        )
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(
            header::CONTENT_SECURITY_POLICY,
            "sandbox; default-src 'none'; script-src 'none'; object-src 'none'",
        )
}

fn ok_response(body: Vec<u8>, content_type: &str) -> Response<Vec<u8>> {
    media_response_builder(StatusCode::OK, content_type)
        .body(body)
        .expect("failed to build media response")
}

fn partial_response(
    body: Vec<u8>,
    content_type: &str,
    start: u64,
    end: u64,
    total: u64,
) -> Response<Vec<u8>> {
    media_response_builder(StatusCode::PARTIAL_CONTENT, content_type)
        .header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{total}"),
        )
        .body(body)
        .expect("failed to build partial media response")
}

fn range_not_satisfiable(total: u64) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_RANGE, format!("bytes */{total}"))
        .body(Vec::new())
        .expect("failed to build range error response")
}

fn error_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .expect("failed to build media error response")
}

fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join(CACHE_SUBDIR))
        .map_err(|err| err.to_string())
}

fn cache_key(session_token: &str, url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session_token.as_bytes());
    hasher.update([0]);
    hasher.update(url.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use tauri::http::{header, StatusCode};

    use super::{
        cache_key, fits_in_cache, ok_response, parse_range, partial_response, serve_range_memory,
    };

    #[test]
    fn cache_key_is_stable_and_hex() {
        let url = "https://matrix.example.org/_matrix/client/v1/media/download/x/y";
        let key = cache_key("account-a-token", url);
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(key, cache_key("account-a-token", url));
    }

    #[test]
    fn cache_key_is_scoped_to_the_session() {
        let url = "https://matrix.example.org/_matrix/client/v1/media/download/x/y";
        assert_ne!(
            cache_key("account-a-token", url),
            cache_key("account-b-token", url)
        );
    }

    #[test]
    fn protocol_responses_are_privately_cacheable_by_the_webview() {
        let response = ok_response(Vec::new(), "image/png");
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "private, max-age=31536000, immutable"
        );
        assert_eq!(
            response.headers().get(header::ACCEPT_RANGES).unwrap(),
            "bytes"
        );
    }

    #[test]
    fn parse_range_handles_the_common_forms() {
        assert_eq!(parse_range("bytes=0-499", 1000), Some((0, 499)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=0-", 1000), Some((0, 999)));
        // End past the file is clamped to the last byte.
        assert_eq!(parse_range("bytes=990-5000", 1000), Some((990, 999)));
        // Suffix range: the last N bytes.
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
    }

    #[test]
    fn parse_range_rejects_unsatisfiable_and_malformed() {
        assert_eq!(parse_range("bytes=1000-1001", 1000), None);
        assert_eq!(parse_range("bytes=500-400", 1000), None);
        assert_eq!(parse_range("bytes=abc-def", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-0", 0), None);
    }

    #[test]
    fn partial_response_reports_the_served_range() {
        let response = partial_response(vec![0_u8; 100], "video/mp4", 0, 99, 5000);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 0-99/5000"
        );
        assert_eq!(
            response.headers().get(header::ACCEPT_RANGES).unwrap(),
            "bytes"
        );
    }

    #[test]
    fn oversized_media_is_not_cacheable() {
        assert!(fits_in_cache(0));
        assert!(fits_in_cache(super::MAX_CACHE_BYTES));
        assert!(!fits_in_cache(super::MAX_CACHE_BYTES + 1));
    }

    #[test]
    fn serve_range_memory_slices_the_in_memory_body() {
        let body: Vec<u8> = (0..200u8).collect();
        let response = serve_range_memory(body.clone(), "application/octet-stream", "bytes=10-19");
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), &body[10..=19]);
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 10-19/200"
        );
    }

    #[test]
    fn serve_range_memory_caps_at_max_range_chunk() {
        let body = vec![7_u8; (super::MAX_RANGE_CHUNK * 2) as usize];
        let response = serve_range_memory(body, "application/octet-stream", "bytes=0-");
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body().len() as u64, super::MAX_RANGE_CHUNK);
        let total = super::MAX_RANGE_CHUNK * 2;
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            &format!("bytes 0-{}/{total}", super::MAX_RANGE_CHUNK - 1)
        );
    }

    #[test]
    fn serve_range_memory_rejects_unsatisfiable_range() {
        let response = serve_range_memory(Vec::new(), "application/octet-stream", "bytes=0-0");
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }
}
