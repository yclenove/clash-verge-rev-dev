#[cfg(not(clash_verge_mobile))]
pub mod autostart;
#[cfg(clash_verge_mobile)]
pub mod autostart_android;
#[cfg(clash_verge_mobile)]
pub use autostart_android as autostart;
pub mod backup;
mod clash_log;
pub mod handle;
#[cfg(not(clash_verge_mobile))]
pub mod hotkey;
#[cfg(clash_verge_mobile)]
pub mod hotkey_android;
#[cfg(clash_verge_mobile)]
pub use hotkey_android as hotkey;
pub mod listener;
pub(crate) mod log_store;
pub mod logger;
pub mod manager;
mod notification;
pub(crate) mod owner_identity;
pub mod proxy_control;
pub mod proxy_view;
pub mod runstate;
mod runtime_bundle;
pub mod service;
#[cfg(not(clash_verge_mobile))]
pub mod sysopt;
#[cfg(all(clash_verge_mobile, not(target_env = "ohos")))]
pub mod sysopt_android;
#[cfg(target_env = "ohos")]
pub mod sysopt_ohos;
#[cfg(not(clash_verge_mobile))]
pub use sysopt::Sysopt;
#[cfg(all(clash_verge_mobile, not(target_env = "ohos")))]
pub use sysopt_android::Sysopt;
#[cfg(target_env = "ohos")]
pub use sysopt_ohos::Sysopt;
pub mod timer;
#[cfg(not(clash_verge_mobile))]
pub mod tray;
#[cfg(clash_verge_mobile)]
pub mod tray_android;
#[cfg(clash_verge_mobile)]
pub use tray_android as tray;
pub mod validate;
pub mod win_uwp;

pub use self::{manager::CoreManager, timer::Timer};
