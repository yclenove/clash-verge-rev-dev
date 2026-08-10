use super::CmdResult;
use crate::utils::dirs;
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;

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

    let mut result = HashMap::new();
    for server in servers {
        let mut info = ServerGeoInfo::default();

        let ip = match tokio::net::lookup_host((server.as_str(), 0)).await {
            Ok(mut addrs) => addrs.next().map(|addr| addr.ip()),
            Err(_) => server.parse::<IpAddr>().ok(),
        };

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
