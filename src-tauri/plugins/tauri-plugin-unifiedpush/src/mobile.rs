use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "moe.sable.unifiedpush";

pub struct UnifiedPush<R: Runtime>(pub PluginHandle<R>);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<UnifiedPush<R>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "android")]
    {
        let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "UnifiedPushPlugin")?;
        Ok(UnifiedPush(handle))
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("UnifiedPush is only available on Android".into())
    }
}
