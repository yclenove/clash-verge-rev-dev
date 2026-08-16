use serde_yaml_ng::Mapping;

#[cfg(all(target_os = "linux", not(target_env = "ohos")))]
use serde_yaml_ng::Value;

#[cfg(all(target_os = "linux", not(target_env = "ohos")))]
const LINUX_DNS_LISTEN: &str = "127.0.0.1:1053";

/// Migrates legacy wildcard DNS defaults without changing explicit custom listeners.
#[cfg_attr(
    not(all(target_os = "linux", not(target_env = "ohos"))),
    allow(clippy::needless_pass_by_ref_mut)
)]
pub(crate) const fn normalize_dns_listen(config: &mut Mapping) -> bool {
    #[cfg(not(all(target_os = "linux", not(target_env = "ohos"))))]
    {
        let _ = config;
        false
    }

    #[cfg(all(target_os = "linux", not(target_env = "ohos")))]
    {
        if let Some(Value::Mapping(dns)) = config.get_mut(Value::from("dns")) {
            return normalize_linux_dns_mapping(dns);
        }
        normalize_linux_dns_mapping(config)
    }
}

#[cfg(all(target_os = "linux", not(target_env = "ohos")))]
fn normalize_linux_dns_mapping(dns: &mut Mapping) -> bool {
    let Some(Value::String(listen)) = dns.get_mut(Value::from("listen")) else {
        return false;
    };
    if !matches!(listen.trim(), ":53" | ":1053") {
        return false;
    }

    *listen = LINUX_DNS_LISTEN.into();
    true
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::normalize_dns_listen;
    use serde_yaml_ng::{Mapping, Value};

    fn mapping(yaml: &str) -> Mapping {
        serde_yaml_ng::from_str(yaml).expect("test YAML should be valid")
    }

    #[test]
    fn linux_migrates_wrapped_and_direct_legacy_defaults() {
        for (yaml, wrapped) in [("dns:\n  listen: :53\n", true), ("listen: :1053\n", false)] {
            let mut config = mapping(yaml);
            assert!(normalize_dns_listen(&mut config));
            let dns = if wrapped {
                config
                    .get(Value::from("dns"))
                    .and_then(Value::as_mapping)
                    .expect("wrapped DNS mapping")
            } else {
                &config
            };
            assert_eq!(
                dns.get(Value::from("listen")).and_then(Value::as_str),
                Some("127.0.0.1:1053")
            );
        }
    }

    #[test]
    fn linux_preserves_explicit_and_custom_listeners() {
        for listen in ["0.0.0.0:1053", "[::]:1053", "127.0.0.1:53", ":5353"] {
            let mut config = Mapping::new();
            config.insert(Value::from("listen"), Value::from(listen));
            assert!(
                !normalize_dns_listen(&mut config),
                "listener {listen} is explicit or custom"
            );
            assert_eq!(config.get(Value::from("listen")).and_then(Value::as_str), Some(listen));
        }
    }
}
