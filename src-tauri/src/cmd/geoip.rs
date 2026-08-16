use super::CmdResult;
use crate::utils::dirs;
use futures::StreamExt as _;
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

/// Geo information for a single proxy server address.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerGeoInfo {
    pub ip: Option<String>,
    pub country_code: Option<String>,
    pub country: Option<String>,
}

#[derive(serde::Deserialize)]
struct CountryRecord {
    #[serde(default)]
    country: Option<CountryData>,
}

#[derive(serde::Deserialize)]
struct CountryData {
    #[serde(default)]
    iso_code: Option<String>,
    #[serde(default)]
    names: Option<HashMap<String, String>>,
}

fn pick_name(names: &HashMap<String, String>) -> Option<String> {
    names
        .get("zh-CN")
        .or_else(|| names.get("en"))
        .or_else(|| names.values().next())
        .cloned()
}

fn lookup_host_name(server: &str) -> &str {
    match server.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => host,
        _ => server,
    }
}

async fn resolve_server_ip(server: &str) -> Option<IpAddr> {
    if let Ok(ip) = server.parse::<IpAddr>() {
        return Some(ip);
    }

    let host = lookup_host_name(server);
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Some(ip);
    }

    match tokio::time::timeout(Duration::from_millis(300), tokio::net::lookup_host((host, 0))).await {
        Ok(Ok(mut addrs)) => addrs.next().map(|addr| addr.ip()),
        _ => None,
    }
}

/// Resolve a batch of proxy server addresses to their IP and GeoIP country.
///
/// The lookup uses the bundled `Country.mmdb` database, so it works fully offline.
/// Hostnames are resolved with the system resolver; addresses that are already IPs
/// are used directly. Failures degrade gracefully to empty fields.
#[tauri::command]
pub async fn lookup_servers_geoip(servers: Vec<String>) -> CmdResult<HashMap<String, ServerGeoInfo>> {
    let reader = dirs::app_home_dir()
        .ok()
        .map(|dir| dir.join("Country.mmdb"))
        .filter(|path| path.exists())
        .and_then(|path| maxminddb::Reader::open_readfile(path).ok());

    let resolved: Vec<(String, Option<IpAddr>)> = futures::stream::iter(servers.into_iter().map(|server| async move {
        let ip = resolve_server_ip(&server).await;
        (server, ip)
    }))
    .buffer_unordered(8)
    .collect()
    .await;

    let mut result = HashMap::new();
    for (server, ip) in resolved {
        let mut info = ServerGeoInfo::default();
        if let Some(ip) = ip {
            info.ip = Some(ip.to_string());
            if let Some(reader) = &reader
                && let Ok(record) = reader.lookup::<CountryRecord>(ip)
                && let Some(country) = record.country
            {
                info.country_code = country.iso_code;
                info.country = country.names.as_ref().and_then(pick_name);
            }
        }
        result.insert(server, info);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::lookup_host_name;

    #[test]
    fn lookup_host_name_strips_numeric_port() {
        assert_eq!(lookup_host_name("host:443"), "host");
    }

    #[test]
    fn lookup_host_name_keeps_bare_ipv4() {
        assert_eq!(lookup_host_name("1.2.3.4"), "1.2.3.4");
    }

    #[test]
    fn lookup_host_name_keeps_bare_hostname() {
        assert_eq!(lookup_host_name("example.com"), "example.com");
    }
}
