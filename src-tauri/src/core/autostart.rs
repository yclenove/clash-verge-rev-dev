#[cfg(target_os = "windows")]
use crate::utils::schtasks;
use crate::{config::Config, core::handle::Handle};
use anyhow::Result;
#[cfg(not(target_os = "windows"))]
use clash_verge_logging::logging_error;
use clash_verge_logging::{Type, logging};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_autostart::ManagerExt as _;
#[cfg(target_os = "windows")]
use tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin;

pub async fn update_launch() -> Result<()> {
    let enable_auto_launch = { Config::verge().await.latest_arc().enable_auto_launch };
    let is_enable = enable_auto_launch.unwrap_or(false);
    logging!(info, Type::System, "设置开机自启状态为: {is_enable}");

    #[cfg(target_os = "windows")]
    {
        let is_admin = is_current_app_handle_admin(Handle::app_handle());
        schtasks::set_auto_launch(is_enable, is_admin).await?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let app_handle = Handle::app_handle();
        let autostart_manager = app_handle.autolaunch();
        if is_enable {
            logging_error!(Type::System, "{:?}", autostart_manager.enable());
        } else {
            logging_error!(Type::System, "{:?}", autostart_manager.disable());
        }
    }

    Ok(())
}

pub fn get_launch_status() -> Result<bool> {
    #[cfg(target_os = "windows")]
    {
        let enabled = schtasks::is_auto_launch_enabled();
        if let Ok(status) = enabled {
            logging!(info, Type::System, "开机自启状态（计划任务）: {status}");
        }
        enabled
    }

    #[cfg(not(target_os = "windows"))]
    {
        let app_handle = Handle::app_handle();
        let autostart_manager = app_handle.autolaunch();
        match autostart_manager.is_enabled() {
            Ok(status) => {
                logging!(info, Type::System, "开机自启状态: {status}");
                Ok(status)
            }
            Err(e) => {
                logging!(error, Type::System, "获取开机自启状态失败: {e}");
                Err(anyhow::anyhow!("Failed to get auto-launch status: {}", e))
            }
        }
    }
}
