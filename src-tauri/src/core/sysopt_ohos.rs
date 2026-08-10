use crate::{
    config::Config,
    core::handle::Handle,
};
use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use std::ffi::CStr;
use std::sync::Arc;

const MAX_STR_LEN: usize = 256;
const MAX_EXCLUSION_SIZE: usize = 256;
#[repr(C)]
struct NetConnHttpProxy {
    host: [u8; MAX_STR_LEN],
    exclusion_list: [[u8; MAX_STR_LEN]; MAX_EXCLUSION_SIZE],
    exclusion_list_size: i32,
    port: u16,
}

#[link(name = "net_connection")]
unsafe extern "C" {
    fn OH_NetConn_SetAppHttpProxy(http_proxy: *mut NetConnHttpProxy) -> i32;
    fn OH_NetConn_GetDefaultHttpProxy(http_proxy: *mut NetConnHttpProxy) -> i32;
}

fn read_field(buf: &[u8]) -> String {
    CStr::from_bytes_until_nul(buf)
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub(crate) fn clear_app_http_proxy() -> Result<()> {
    let mut proxy = NetConnHttpProxy {
        host: [0; MAX_STR_LEN],
        exclusion_list: [[0; MAX_STR_LEN]; MAX_EXCLUSION_SIZE],
        exclusion_list_size: 0,
        port: 0,
    };
    logging!(info, Type::Network, "OHOS clear app http proxy");
    let rc = unsafe { OH_NetConn_SetAppHttpProxy(&mut proxy) };
    if rc != 0 {
        bail!("OH_NetConn_SetAppHttpProxy(clear) failed with code {rc}");
    }
    Ok(())
}

pub(crate) fn read_app_http_proxy() -> Result<Option<(String, u16, Vec<String>)>> {
    let mut proxy = NetConnHttpProxy {
        host: [0; MAX_STR_LEN],
        exclusion_list: [[0; MAX_STR_LEN]; MAX_EXCLUSION_SIZE],
        exclusion_list_size: 0,
        port: 0,
    };
    let rc = unsafe { OH_NetConn_GetDefaultHttpProxy(&mut proxy) };
    if rc != 0 {
        bail!("OH_NetConn_GetDefaultHttpProxy failed with code {rc}");
    }
    let host = read_field(&proxy.host);
    if host.is_empty() || proxy.port == 0 {
        logging!(info, Type::Network, "OHOS app http proxy is not set");
        return Ok(None);
    }
    let mut exclusion = Vec::new();
    let size = proxy.exclusion_list_size.clamp(0, MAX_EXCLUSION_SIZE as i32) as usize;
    for index in 0..size {
        let item = read_field(&proxy.exclusion_list[index]);
        if !item.is_empty() {
            exclusion.push(item);
        }
    }
    logging!(
        info,
        Type::Network,
        "OHOS app http proxy active {host}:{}",
        proxy.port
    );
    Ok(Some((host, proxy.port, exclusion)))
}

/// OHOS exposes only an application-level HTTP proxy to normal apps. The
/// desktop Sysopt surface is kept so the proxy-control pipeline still compiles.
pub struct Sysopt;

static SYSOPT: Lazy<Arc<Sysopt>> = Lazy::new(|| Arc::new(Sysopt));

impl Sysopt {
    pub fn global() -> Arc<Sysopt> {
        SYSOPT.clone()
    }

    pub async fn wait_idle(&self) {}

    pub async fn update_sysproxy(&self) -> Result<()> {
        let verge = Config::verge().await.latest_arc();
        if verge.enable_system_proxy.unwrap_or_default() {
            logging!(
                warn,
                Type::Network,
                "OHOS does not provide a third-party global HTTP proxy; clearing legacy app proxy"
            );
        }
        clear_app_http_proxy()?;
        Handle::refresh_verge();
        Ok(())
    }

    pub async fn reset_sysproxy(&self) -> Result<()> {
        clear_app_http_proxy()?;
        Handle::refresh_verge();
        Ok(())
    }

    pub async fn stop_proxy_guard(self: Arc<Self>) {}

    pub async fn refresh_guard(&self) {}
}
