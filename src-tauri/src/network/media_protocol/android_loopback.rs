use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, RwLock},
    thread,
    time::Duration,
};

use sha2::{Digest, Sha256};
use tauri::http::{header, Response, StatusCode};

use super::session::MediaSession;

// Frees the socket if a fetch never completes, instead of holding a per-host connection forever.
const PENDING_WAIT: Duration = Duration::from_secs(120);
const KEEP_ALIVE_IDLE: Duration = Duration::from_secs(30);

pub(super) struct LoopbackMediaServer {
    origin: String,
    routes: Arc<RwLock<HashMap<String, Route>>>,
}

#[derive(Clone)]
enum Route {
    Ready(CachedMedia),
    /// Registered before the fetch starts so the custom protocol can redirect immediately.
    Pending(Arc<PendingMedia>),
}

/// One in-flight fetch, read by loopback connections while the fetch task writes it.
pub(super) struct PendingMedia {
    state: Mutex<PendingState>,
    changed: Condvar,
}

#[derive(Default)]
struct PendingState {
    stream: Option<PendingStream>,
    written: u64,
    outcome: Option<Option<CachedMedia>>,
}

#[derive(Clone)]
struct PendingStream {
    path: PathBuf,
    content_type: String,
    total: u64,
}

enum PendingStart {
    /// Known length, so the staging file can be tailed as it lands.
    Stream(PendingStream),
    Done(Option<CachedMedia>),
}

impl PendingMedia {
    fn new() -> Self {
        Self {
            state: Mutex::new(PendingState::default()),
            changed: Condvar::new(),
        }
    }

    /// Only plaintext media of known length streams; everything else waits for [`Self::resolve`].
    pub(super) fn begin_stream(&self, path: PathBuf, content_type: String, total: u64) {
        if let Ok(mut state) = self.state.lock() {
            state.stream = Some(PendingStream {
                path,
                content_type,
                total,
            });
        }
        self.changed.notify_all();
    }

    pub(super) fn advance(&self, written: u64) {
        if let Ok(mut state) = self.state.lock() {
            state.written = written;
        }
        self.changed.notify_all();
    }

    pub(super) fn resolve(&self, media: Option<(PathBuf, String)>) {
        let media = media.map(|(path, content_type)| CachedMedia { path, content_type });
        if let Ok(mut state) = self.state.lock() {
            state.outcome = Some(media);
        }
        self.changed.notify_all();
    }

    fn wait_start(&self) -> PendingStart {
        let Ok(state) = self.state.lock() else {
            return PendingStart::Done(None);
        };
        let Ok((state, _)) = self
            .changed
            .wait_timeout_while(state, PENDING_WAIT, |state| {
                state.stream.is_none() && state.outcome.is_none()
            })
        else {
            return PendingStart::Done(None);
        };
        match (&state.stream, &state.outcome) {
            // A fetch that already finished is served from its final path, not the staging file.
            (_, Some(outcome)) => PendingStart::Done(outcome.clone()),
            (Some(stream), None) => PendingStart::Stream(stream.clone()),
            (None, None) => PendingStart::Done(None),
        }
    }

    fn wait_start_done(&self) -> Option<CachedMedia> {
        let state = self.state.lock().ok()?;
        let (state, _) = self
            .changed
            .wait_timeout_while(state, PENDING_WAIT, |state| state.outcome.is_none())
            .ok()?;
        state.outcome.clone().flatten()
    }

    /// Blocks until more than `have` bytes have landed, or the fetch ends. `None` means no more
    /// bytes are coming.
    fn wait_for(&self, have: u64) -> Option<u64> {
        let state = self.state.lock().ok()?;
        let (state, _) = self
            .changed
            .wait_timeout_while(state, PENDING_WAIT, |state| {
                state.written <= have && state.outcome.is_none()
            })
            .ok()?;
        if state.written > have {
            return Some(state.written);
        }
        // Resolved without new bytes: a failure leaves the body short of `total`.
        state
            .outcome
            .as_ref()
            .and_then(|outcome| outcome.as_ref())?;
        None
    }
}

#[derive(Clone)]
struct CachedMedia {
    path: PathBuf,
    content_type: String,
}

impl LoopbackMediaServer {
    pub(super) fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let origin = format!("http://127.0.0.1:{}", listener.local_addr()?.port());
        let routes = Arc::new(RwLock::new(HashMap::<String, Route>::new()));
        let server_routes = Arc::clone(&routes);
        thread::Builder::new()
            .name("sable-media-loopback".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let routes = Arc::clone(&server_routes);
                    let _ = thread::Builder::new()
                        .name("sable-media-request".into())
                        .spawn(move || serve(stream, routes));
                }
            })?;

        Ok(Self { origin, routes })
    }

    pub(super) fn clear(&self) {
        if let Ok(mut routes) = self.routes.write() {
            routes.clear();
        }
    }

    pub(super) fn redirect_response(
        &self,
        session: &MediaSession,
        cache_key: &str,
        path: PathBuf,
        content_type: &str,
    ) -> Response<Vec<u8>> {
        let capability = capability(session, cache_key);
        if let Ok(mut routes) = self.routes.write() {
            routes.insert(
                capability.clone(),
                Route::Ready(CachedMedia {
                    path,
                    content_type: content_type.to_owned(),
                }),
            );
        }
        self.redirect_to(&capability)
    }

    /// Returns a handle to resolve when the fetch finishes, or `None` if one is already running.
    pub(super) fn redirect_pending(
        &self,
        session: &MediaSession,
        cache_key: &str,
    ) -> (Response<Vec<u8>>, Option<Arc<PendingMedia>>) {
        let capability = capability(session, cache_key);
        let pending = match self.routes.write() {
            Ok(mut routes) => {
                if routes.contains_key(&capability) {
                    None
                } else {
                    let pending = Arc::new(PendingMedia::new());
                    routes.insert(capability.clone(), Route::Pending(Arc::clone(&pending)));
                    Some(pending)
                }
            }
            Err(_) => None,
        };
        (self.redirect_to(&capability), pending)
    }

    /// Swaps the pending entry for the finished file so later requests skip straight to it.
    pub(super) fn publish(
        &self,
        session: &MediaSession,
        cache_key: &str,
        media: Option<(PathBuf, String)>,
    ) {
        let capability = capability(session, cache_key);
        if let Ok(mut routes) = self.routes.write() {
            match &media {
                Some((path, content_type)) => routes.insert(
                    capability,
                    Route::Ready(CachedMedia {
                        path: path.clone(),
                        content_type: content_type.clone(),
                    }),
                ),
                // A failed fetch must not linger: the next request has to retry it.
                None => routes.remove(&capability),
            };
        }
    }

    fn redirect_to(&self, capability: &str) -> Response<Vec<u8>> {
        Response::builder()
            .status(StatusCode::FOUND)
            .header(header::LOCATION, format!("{}/{}", self.origin, capability))
            .header(header::CACHE_CONTROL, "no-store")
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()))
    }
}

fn capability(session: &MediaSession, cache_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session.token.as_bytes());
    hasher.update([0]);
    hasher.update(session.scope.as_bytes());
    hasher.update([0]);
    hasher.update(cache_key.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn serve(stream: TcpStream, routes: Arc<RwLock<HashMap<String, Route>>>) {
    let _ = stream.set_read_timeout(Some(KEEP_ALIVE_IDLE));
    let Ok(mut writer) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(stream);
    while serve_one(&mut reader, &mut writer, &routes) {}
}

fn serve_one(
    reader: &mut BufReader<TcpStream>,
    writer: &mut TcpStream,
    routes: &Arc<RwLock<HashMap<String, Route>>>,
) -> bool {
    let Ok((method, capability, range)) = parse_request(reader) else {
        let _ = write_status(writer, 400, "Bad Request", &[], false);
        return false;
    };
    if method != "GET" && method != "HEAD" {
        let _ = write_status(writer, 405, "Method Not Allowed", &[], false);
        return false;
    }
    let route = routes
        .read()
        .ok()
        .and_then(|routes| routes.get(&capability).cloned());
    let Some(route) = route else {
        let _ = write_status(writer, 404, "Not Found", &[], false);
        return false;
    };
    // Waiting costs a loopback socket rather than a webview thread, with no 30s ceiling over it.
    let media = match route {
        Route::Ready(media) => Some(media),
        Route::Pending(pending) => match pending.wait_start() {
            // A range request wants to seek, which only the finished file can satisfy.
            PendingStart::Stream(stream) if range.is_none() => {
                return serve_stream(writer, &pending, &stream, &method);
            }
            PendingStart::Stream(_) => pending.wait_start_done(),
            PendingStart::Done(media) => media,
        },
    };
    let Some(media) = media else {
        let _ = write_status(writer, 504, "Gateway Timeout", &[], false);
        return false;
    };
    let Ok(mut file) = File::open(media.path) else {
        let _ = write_status(writer, 404, "Not Found", &[], false);
        return false;
    };
    let Ok(total) = file.metadata().map(|metadata| metadata.len()) else {
        let _ = write_status(writer, 500, "Internal Server Error", &[], false);
        return false;
    };
    let selection = range.as_deref().and_then(|value| parse_range(value, total));
    if range.is_some() && selection.is_none() {
        let _ = write_status(
            writer,
            416,
            "Range Not Satisfiable",
            &[("Content-Range", format!("bytes */{total}"))],
            false,
        );
        return false;
    }
    let (start, end, partial) = selection.unwrap_or((0, total.saturating_sub(1), false));
    let length = end.saturating_sub(start) + 1;
    let mut headers = media_headers(&media.content_type, length);
    if partial {
        headers.push(("Content-Range", format!("bytes {start}-{end}/{total}")));
    }
    if write_status(
        writer,
        if partial { 206 } else { 200 },
        if partial { "Partial Content" } else { "OK" },
        &headers,
        true,
    )
    .is_err()
    {
        return false;
    }
    if method == "HEAD" {
        return true;
    }
    if file.seek(SeekFrom::Start(start)).is_err() {
        return false;
    }
    let mut left = length;
    let mut buffer = [0_u8; 64 * 1024];
    while left > 0 {
        let want = left.min(buffer.len() as u64) as usize;
        let Ok(read) = file.read(&mut buffer[..want]) else {
            return false;
        };
        if read == 0 || writer.write_all(&buffer[..read]).is_err() {
            return false;
        }
        left -= read as u64;
    }
    true
}

/// Writes the body as the fetch lands it, so the image paints progressively.
fn serve_stream(
    writer: &mut TcpStream,
    pending: &PendingMedia,
    stream: &PendingStream,
    method: &str,
) -> bool {
    let headers = media_headers(&stream.content_type, stream.total);
    if write_status(writer, 200, "OK", &headers, true).is_err() {
        return false;
    }
    if method == "HEAD" {
        return true;
    }
    let Ok(mut file) = File::open(&stream.path) else {
        return false;
    };
    let mut sent: u64 = 0;
    let mut buffer = [0_u8; 64 * 1024];
    while sent < stream.total {
        // Progress is only published after a flush, so these bytes are readable.
        let Some(available) = pending.wait_for(sent) else {
            return false;
        };
        while sent < available.min(stream.total) {
            let want = (available.min(stream.total) - sent).min(buffer.len() as u64) as usize;
            let Ok(read) = file.read(&mut buffer[..want]) else {
                return false;
            };
            if read == 0 || writer.write_all(&buffer[..read]).is_err() {
                return false;
            }
            sent += read as u64;
        }
    }
    true
}

fn media_headers(content_type: &str, length: u64) -> Vec<(&'static str, String)> {
    vec![
        ("Content-Type", content_type.to_owned()),
        ("Content-Length", length.to_string()),
        ("Accept-Ranges", "bytes".to_owned()),
        (
            "Access-Control-Allow-Origin",
            "https://tauri.localhost".to_owned(),
        ),
        (
            "Cache-Control",
            "private, max-age=31536000, immutable".to_owned(),
        ),
    ]
}

fn parse_request(
    reader: &mut BufReader<TcpStream>,
) -> Result<(String, String, Option<String>), ()> {
    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|_| ())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or(())?.to_owned();
    let path = parts.next().ok_or(())?;
    if parts.next().is_none() || !path.starts_with('/') || path[1..].contains('/') {
        return Err(());
    }
    let mut range = None;
    let mut line = String::new();
    loop {
        line.clear();
        reader.read_line(&mut line).map_err(|_| ())?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some(value) = line
            .strip_prefix("Range:")
            .or_else(|| line.strip_prefix("range:"))
        {
            range = Some(value.trim().to_owned());
        }
        if line.len() > 8192 {
            return Err(());
        }
    }
    Ok((method, path[1..].to_owned(), range))
}

fn parse_range(value: &str, total: u64) -> Option<(u64, u64, bool)> {
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') || total == 0 {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        let length = end.parse::<u64>().ok()?.min(total);
        (length > 0).then_some((total - length, total - 1, true))
    } else {
        let start = start.parse::<u64>().ok()?;
        let end = if end.is_empty() {
            total.checked_sub(1)?
        } else {
            end.parse::<u64>().ok()?.min(total.checked_sub(1)?)
        };
        (start <= end && start < total).then_some((start, end, true))
    }
}

fn write_status(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    headers: &[(&str, String)],
    keep_alive: bool,
) -> std::io::Result<()> {
    let connection = if keep_alive { "keep-alive" } else { "close" };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nConnection: {connection}\r\n"
    )?;
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n")?;
    }
    stream.write_all(b"\r\n")
}
