use std::{
    fs,
    path::PathBuf,
    sync::{OnceLock, RwLock},
};

use sha2::{Digest, Sha256};
use tauri::{
    http::{header, Request, Response, StatusCode, Uri},
    AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder,
};
use tauri_plugin_http::reqwest::{
    header::{AUTHORIZATION, CONTENT_TYPE},
    Client, Url,
};

pub const MEDIA_URI_SCHEME: &str = "sable-media";

const MEDIA_PATH_PREFIXES: [&str; 2] = ["/_matrix/media/", "/_matrix/client/v1/media/"];
const CACHE_SUBDIR: &str = "sable-media";

#[derive(Default)]
pub struct MediaSessionState {
    inner: RwLock<Option<MediaSession>>,
    client: OnceLock<Client>,
}

impl MediaSessionState {
    // Shared across requests so the connection pool and TLS sessions stay warm.
    fn client(&self) -> Client {
        self.client.get_or_init(Client::new).clone()
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
    tauri::async_runtime::spawn(async move {
        let response = handle_request(&app, uri)
            .await
            .unwrap_or_else(error_response);
        responder.respond(response);
    });
}

async fn handle_request<R: Runtime>(
    app: &AppHandle<R>,
    uri: Uri,
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

    if let (Ok(body), Ok(content_type)) =
        (fs::read(&body_path), fs::read_to_string(&content_type_path))
    {
        return Ok(ok_response(body, &content_type));
    }

    let client = app.state::<MediaSessionState>().client();
    let upstream = client
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

    if fs::create_dir_all(&dir).is_ok() {
        let _ = fs::write(&body_path, &body);
        let _ = fs::write(&content_type_path, &content_type);
    }

    Ok(ok_response(body, &content_type))
}

fn ok_response(body: Vec<u8>, content_type: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        // Authorization is enforced by the protocol handler. Do not let the
        // webview reuse this response after the active Matrix session changes.
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(
            header::CONTENT_SECURITY_POLICY,
            "sandbox; default-src 'none'; script-src 'none'; object-src 'none'",
        )
        .body(body)
        .expect("failed to build media response")
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
    use tauri::http::header;

    use super::{cache_key, ok_response};

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
    fn protocol_responses_are_not_cached_by_the_webview() {
        let response = ok_response(Vec::new(), "image/png");
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "private, no-store"
        );
    }
}
