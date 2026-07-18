use tauri::{AppHandle, Manager, Runtime};
use serde::{Deserialize, Serialize};

use crate::mobile;

#[derive(Debug, Deserialize, Serialize)]
pub struct DistributorArgs {
    pub distributor: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TokenArgs {
    pub token: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushNotificationResponse {
    pub device_token: String,
}

#[derive(Debug, Deserialize)]
pub struct DistributorsResponse {
    pub distributors: Vec<String>,
}

#[tauri::command]
pub async fn list_distributors<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = _app.state::<mobile::UnifiedPush<R>>().inner().0.clone();
        plugin
            .run_mobile_plugin_async::<DistributorsResponse>("listDistributors", ())
            .await
            .map(|r| r.distributors)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("UnifiedPush is only available on Android".to_string())
    }
}

#[tauri::command]
pub async fn set_distributor<R: Runtime>(
    _app: AppHandle<R>,
    args: DistributorArgs,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let plugin = _app.state::<mobile::UnifiedPush<R>>().inner().0.clone();
        plugin
            .run_mobile_plugin::<()>("setDistributor", args)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("UnifiedPush is only available on Android".to_string())
    }
}

#[tauri::command]
pub async fn register_for_push_notifications<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = _app.state::<mobile::UnifiedPush<R>>().inner().0.clone();
        plugin
            .run_mobile_plugin_async::<PushNotificationResponse>(
                "registerForPushNotifications",
                (),
            )
            .await
            .map(|r| r.device_token)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("UnifiedPush is only available on Android".to_string())
    }
}

#[tauri::command]
pub async fn unregister_for_push_notifications<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let plugin = _app.state::<mobile::UnifiedPush<R>>().inner().0.clone();
        plugin
            .run_mobile_plugin::<()>("unregisterForPushNotifications", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("UnifiedPush is only available on Android".to_string())
    }
}

#[tauri::command]
pub async fn set_token<R: Runtime>(
    _app: AppHandle<R>,
    args: TokenArgs,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let plugin = _app.state::<mobile::UnifiedPush<R>>().inner().0.clone();
        plugin
            .run_mobile_plugin::<()>("setToken", args)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("UnifiedPush is only available on Android".to_string())
    }
}
