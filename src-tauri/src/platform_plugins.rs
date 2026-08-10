//! Platform plugin shims so OHOS can use local stubs without colliding with
//! crates.io dependency sources (Cargo forbids per-target source paths).

#[cfg(not(target_env = "ohos"))]
pub use tauri_plugin_shell as shell;
#[cfg(target_env = "ohos")]
pub use cv_tauri_plugin_shell as shell;

#[cfg(not(target_env = "ohos"))]
pub use tauri_plugin_clipboard_manager as clipboard_manager;
#[cfg(target_env = "ohos")]
pub use cv_tauri_plugin_clipboard_manager as clipboard_manager;

#[cfg(not(target_env = "ohos"))]
pub use tauri_plugin_notification as notification;
#[cfg(target_env = "ohos")]
pub use cv_tauri_plugin_notification as notification;
