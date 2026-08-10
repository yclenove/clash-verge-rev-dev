use anyhow::Result;
use once_cell::sync::Lazy;
use std::sync::Arc;

/// Android has no OS-level system proxy APIs available to this codebase.
/// Keep the same call surface so desktop proxy control compiles as a no-op.
pub struct Sysopt;

static SYSOPT: Lazy<Arc<Sysopt>> = Lazy::new(|| Arc::new(Sysopt));

impl Sysopt {
    pub fn global() -> Arc<Sysopt> {
        SYSOPT.clone()
    }

    pub async fn wait_idle(&self) {}

    pub async fn update_sysproxy(&self) -> Result<()> {
        Ok(())
    }

    pub async fn reset_sysproxy(&self) -> Result<()> {
        Ok(())
    }

    pub async fn stop_proxy_guard(self: Arc<Self>) {}

    pub async fn refresh_guard(&self) {}
}
