#[cfg(desktop)]
mod desktop;
mod network;

use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

// Runtime selection: CEF or Wry
#[cfg(feature = "cef")]
type BrowserEngine = tauri::Wry;
#[cfg(all(not(feature = "cef"), feature = "wry"))]
use tauri::Wry as BrowserEngine;

pub const MAIN_WINDOW_LABEL: &str = "main";

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
fn prompt_webview_permission(message: &str) -> bool {
    use gtk::prelude::*;
    use gtk::{ButtonsType, DialogFlags, MessageDialog, MessageType, ResponseType};

    let dialog = MessageDialog::new(
        None::<&gtk::Window>,
        DialogFlags::MODAL,
        MessageType::Question,
        ButtonsType::YesNo,
        message,
    );
    dialog.set_title("Permission request");
    let response = dialog.run();
    dialog.close();
    matches!(response, ResponseType::Yes)
}

// Return the remembered decision for a webview permission, or prompt the user
// once and persist their choice for next time.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
fn resolve_webview_permission(
    app: &AppHandle<crate::BrowserEngine>,
    key: &str,
    message: &str,
) -> bool {
    use tauri_plugin_store::StoreExt;

    let store = app.store("permissions.json").ok();
    if let Some(allowed) = store
        .as_ref()
        .and_then(|store| store.get(key))
        .and_then(|value| value.as_bool())
    {
        return allowed;
    }

    let allowed = prompt_webview_permission(message);

    if let Some(store) = &store {
        store.set(key, allowed);
        let _ = store.save();
    }

    allowed
}

pub fn show_or_create_main_window(app: &AppHandle<crate::BrowserEngine>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        #[cfg(desktop)]
        {
            window.unminimize()?;
            window.show()?;
            window.set_focus()?;
        }

        return Ok(());
    }

    log::info!("Main window not found, creating a new one.");

    let builder =
        tauri::WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, tauri::WebviewUrl::default())
            .disable_drag_drop_handler();

    #[cfg(desktop)]
    let builder = builder
        .title(app.package_info().name.clone())
        .resizable(true)
        .fullscreen(false)
        .inner_size(1280.0, 720.0)
        .visible(false);

    #[cfg(target_os = "windows")]
    let builder = builder.decorations(false);

    let _webview_window = builder.build()?;

    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    {
        use tauri::Manager;
        use webkit2gtk::glib::prelude::Cast;
        use webkit2gtk::{
            GeolocationPermissionRequest, NotificationPermissionRequest, PermissionRequestExt,
            SettingsExt, UserMediaPermissionRequest, WebViewExt,
        };
        let app_handle = app.clone();
        if let Some(wv) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = wv.with_webview(move |webview| {
                let gtk_webview = webview.inner();
                if let Some(settings) = gtk_webview.settings() {
                    settings.set_enable_webrtc(true);
                    settings.set_enable_media_stream(true);
                    settings.set_enable_mediasource(true);
                    settings.set_enable_media(true);
                }
                gtk_webview.connect_permission_request(move |_wv, request| {
                    // Ask the user (once per permission type, then remember the choice)
                    // for the permissions Sable actually uses; deny anything else.
                    let decision = if request
                        .downcast_ref::<UserMediaPermissionRequest>()
                        .is_some()
                    {
                        Some(("media", "Allow Sable to use your camera and microphone?"))
                    } else if request
                        .downcast_ref::<NotificationPermissionRequest>()
                        .is_some()
                    {
                        Some(("notifications", "Allow Sable to show desktop notifications?"))
                    } else if request
                        .downcast_ref::<GeolocationPermissionRequest>()
                        .is_some()
                    {
                        Some(("geolocation", "Allow Sable to access your location?"))
                    } else {
                        None
                    };

                    match decision {
                        Some((key, message))
                            if resolve_webview_permission(&app_handle, key, message) =>
                        {
                            request.allow();
                        }
                        _ => request.deny(),
                    }
                    true
                });
            });
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::<BrowserEngine>::new();

    // macOS needs a standard menu (with the Edit submenu) for keyboard
    // copy/paste/select-all to work in the webview. It lives in the system menu
    // bar, so it is macOS-only to avoid an in-window menu bar elsewhere.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|handle| tauri::menu::Menu::default(handle));

    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE & !StateFlags::DECORATIONS)
            .build(),
    );

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(desktop::tray::DesktopSettingsState::default());

    #[cfg(windows)]
    let builder = builder.manage(std::sync::Arc::new(
        desktop::windows::window_tracking::TrackingState::new(),
    ));

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        let _ = show_or_create_main_window(app);
    }));

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_notifications::init());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_edge_to_edge::init());

    let app = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .manage(network::media_protocol::MediaSessionState::default())
        .register_asynchronous_uri_scheme_protocol(
            network::media_protocol::MEDIA_URI_SCHEME,
            network::media_protocol::respond,
        )
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            show_or_create_main_window(app.handle())?;

            #[cfg(desktop)]
            desktop::tray::sync_desktop_settings_inner(app.handle())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            network::loopback_http::abort_loopback_fetch,
            network::loopback_http::loopback_fetch,
            network::media_protocol::set_media_session,
            network::media_protocol::clear_media_session,
            #[cfg(desktop)]
            desktop::tray::get_desktop_runtime_state,
            #[cfg(desktop)]
            desktop::tray::sync_desktop_settings,
            #[cfg(windows)]
            desktop::windows::snap_overlay::show_snap_overlay,
            #[cfg(windows)]
            desktop::windows::snap_overlay::hide_snap_overlay,
            #[cfg(windows)]
            desktop::windows::window_tracking::start_window_tracking_with_target,
            #[cfg(windows)]
            desktop::windows::window_tracking::stop_window_tracking,
            #[cfg(windows)]
            desktop::windows::window_tracking::is_window_tracking_active,
        ])
        .build(tauri::generate_context!());

    let Ok(app) = app else {
        // On Android this function is called through JNI. Panicking here causes
        // "panic_cannot_unwind" and aborts the whole process without a useful
        // message in logcat.
        eprintln!("failed to build tauri application: {app:?}");
        return;
    };

    app.run(|app, event| {
        #[cfg(desktop)]
        desktop::tray::handle_run_event(app, event);

        #[cfg(not(desktop))]
        let _ = (app, event);
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn desktop_modules_are_grouped_under_desktop() {
        let _ = crate::desktop::settings::DesktopSettings {
            close_to_background_on_close: true,
            show_system_tray_icon: true,
        };
        let _ = crate::desktop::runtime_state::DesktopRuntimeState {
            tray_available: true,
        };
    }
}
