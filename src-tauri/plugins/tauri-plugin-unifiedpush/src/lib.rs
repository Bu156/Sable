use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod mobile;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("unifiedpush")
        .invoke_handler(tauri::generate_handler![
            commands::list_distributors,
            commands::set_distributor,
            commands::register_for_push_notifications,
            commands::unregister_for_push_notifications,
            commands::set_token,
        ])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            {
                let unifiedpush = mobile::init(app, _api)?;
                app.manage(unifiedpush);
            }
            Ok(())
        })
        .build()
}
