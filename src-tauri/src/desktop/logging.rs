use tauri::AppHandle;
use tauri_plugin_log::{Builder, FileOpenStrategy, RotationStrategy};

const MAX_LOG_FILE_SIZE: u128 = 5 * 1024 * 1024;
const ROTATED_LOG_COUNT: usize = 5;

fn builder() -> Builder {
    Builder::default()
        .level(log::LevelFilter::Info)
        .max_file_size(MAX_LOG_FILE_SIZE)
        .rotation_strategy(RotationStrategy::KeepSome(ROTATED_LOG_COUNT))
        .file_open_strategy(FileOpenStrategy::Append)
}

pub fn setup(app: &AppHandle<crate::BrowserEngine>) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(all(debug_assertions, feature = "devtools"))]
    {
        let (log_plugin, _level, logger) = builder().split(app)?;
        let mut devtools = tauri_plugin_devtools::Builder::default();
        devtools.attach_logger(logger);
        app.plugin(devtools.init())?;
        app.plugin(log_plugin)?;
    }

    #[cfg(not(all(debug_assertions, feature = "devtools")))]
    app.plugin(builder().build())?;

    Ok(())
}
