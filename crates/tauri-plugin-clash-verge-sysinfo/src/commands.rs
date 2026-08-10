use parking_lot::RwLock;
use serde::Serialize;
use tauri::{AppHandle, Runtime, State, command};

#[cfg(not(target_env = "ohos"))]
use tauri_plugin_clipboard_manager::{ClipboardExt as _, Error as ClipboardError};

#[cfg(not(target_env = "ohos"))]
type CmdError = ClipboardError;
#[cfg(target_env = "ohos")]
type CmdError = String;

#[derive(Serialize)]
pub struct SystemInfo {
    pub system_name: String,
    pub system_version: String,
    pub system_kernel_version: String,
    pub system_arch: String,
    pub app_version: String,
    pub app_core_mode: String,
    pub app_is_admin: bool,
}

impl From<crate::Platform> for SystemInfo {
    fn from(platform: crate::Platform) -> Self {
        Self {
            system_name: platform.sysinfo.system_name,
            system_version: platform.sysinfo.system_version,
            system_kernel_version: platform.sysinfo.system_kernel_version,
            system_arch: platform.sysinfo.system_arch,
            app_version: platform.appinfo.app_version,
            app_core_mode: platform.appinfo.app_core_mode,
            app_is_admin: platform.appinfo.app_is_admin,
        }
    }
}

#[command]
pub fn get_system_info(state: State<'_, RwLock<crate::Platform>>) -> Result<SystemInfo, CmdError> {
    let platform = state.inner().read();
    Ok(SystemInfo::from(platform.clone()))
}

/// 获取应用的运行时间（毫秒）
#[command]
pub fn get_app_uptime(state: State<'_, RwLock<crate::Platform>>) -> Result<u128, CmdError> {
    Ok(state.inner().read().appinfo.app_startup_time.elapsed().as_millis())
}

/// 检查应用是否以管理员身份运行
#[command]
pub fn app_is_admin(state: State<'_, RwLock<crate::Platform>>) -> Result<bool, CmdError> {
    Ok(state.inner().read().appinfo.app_is_admin)
}

#[command]
pub fn export_diagnostic_info<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, RwLock<crate::Platform>>,
) -> Result<(), CmdError> {
    let info = state.inner().read().to_string();
    #[cfg(not(target_env = "ohos"))]
    {
        let clipboard = app_handle.clipboard();
        clipboard.write_text(info)?;
        Ok(())
    }
    #[cfg(target_env = "ohos")]
    {
        let _ = app_handle;
        let _ = info;
        Err("clipboard unavailable on OpenHarmony build".into())
    }
}
