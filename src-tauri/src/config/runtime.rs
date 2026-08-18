use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::collections::{HashMap, HashSet};

use crate::enhance::field::use_keys;

const PATCH_CONFIG_INNER: [&str; 5] = ["allow-lan", "ipv6", "log-level", "unified-delay", "tunnels"];

#[derive(Default, Clone)]
pub struct IRuntime {
    pub config: Option<Mapping>,
    // 记录在订阅中（包括merge和script生成的）出现过的keys
    // 这些keys不一定都生效
    pub exists_keys: HashSet<String>,
    // TODO 或许可以用 FixMap 来存储以提升效率
    pub chain_logs: HashMap<String, Vec<(String, String)>>,
    // Names of proxies injected into the runtime config by a proxy-chain operation.
    // They are removed again when the chain is cleared so the runtime stays clean.
    pub chain_injected_proxies: Vec<String>,
    // (group name, node name) pairs added to proxy-groups by a chain operation.
    pub chain_injected_group_members: Vec<(String, String)>,
    // User-defined dialer-proxy values overwritten by the last global chain.
    // Cleared/disconnected chains restore only these entries so profile-level
    // hops (e.g. Cursor ISP: Thordata-ISP -> JMS) are left intact.
    pub chain_overwritten_dialer_proxies: Vec<(String, Option<Value>)>,
}

impl IRuntime {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    // 这里只更改 allow-lan | ipv6 | log-level | tun | tunnels
    #[inline]
    pub fn patch_config(&mut self, patch: &Mapping) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        for key in PATCH_CONFIG_INNER.iter() {
            if let Some(value) = patch.get(key) {
                config.insert((*key).into(), value.clone());
            }
        }

        let Some(patch_tun) = patch.get("tun") else {
            return;
        };

        let tun_key = Value::from("tun");
        if !matches!(config.get(&tun_key), Some(Value::Mapping(_))) {
            config.insert(tun_key.clone(), Value::Mapping(Mapping::new()));
        }

        if let (Some(patch_tun_mapping), Some(Value::Mapping(tun))) = (patch_tun.as_mapping(), config.get_mut(&tun_key))
        {
            for key in use_keys(patch_tun_mapping) {
                if let Some(value) = patch_tun_mapping.get(key.as_str()) {
                    tun.insert(Value::from(key.as_str()), value.clone());
                }
            }
        }
    }

    /// 更新链式代理配置
    ///
    /// 该函数更新 `proxies` 和 `proxy-groups` 配置，并处理链式代理的修改或(传入 None )删除。
    ///
    /// 配置示例：
    ///
    /// ```json
    /// {
    ///     "proxies": [
    ///         {
    ///             "name": "入口节点",
    ///             "type": "xxx",
    ///             "server": "xxx",
    ///             "port": "xxx",
    ///             "ports": "xxx",
    ///             "password": "xxx",
    ///             "skip-cert-verify": "xxx"
    ///         },
    ///         {
    ///             "name": "hop_node_1_xxxx",
    ///             "type": "xxx",
    ///             "server": "xxx",
    ///             "port": "xxx",
    ///             "ports": "xxx",
    ///             "password": "xxx",
    ///             "skip-cert-verify": "xxx",
    ///             "dialer-proxy": "入口节点"
    ///         },
    ///         {
    ///             "name": "出口节点",
    ///             "type": "xxx",
    ///             "server": "xxx",
    ///             "port": "xxx",
    ///             "ports": "xxx",
    ///             "password": "xxx",
    ///             "skip-cert-verify": "xxx",
    ///             "dialer-proxy": "hop_node_1_xxxx"
    ///         }
    ///     ],
    ///     "proxy-groups": [
    ///         {
    ///             "name": "proxy_chain",
    ///             "type": "select",
    ///             "proxies": ["出口节点"]
    ///         }
    ///     ]
    /// }
    /// ```
    #[inline]
    #[allow(clippy::cognitive_complexity)]
    pub fn update_proxy_chain_config(&mut self, proxy_chain_config: Option<Value>, chain_group: Option<String>) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        // 1. Restore dialer-proxy values overwritten by a previous global chain.
        //    Do not strip user/profile dialer-proxy entries.
        let previous_overwrites = std::mem::take(&mut self.chain_overwritten_dialer_proxies);
        restore_overwritten_dialer_proxies(config, previous_overwrites);

        // 2. Remove proxies that were injected by a previous chain operation.
        if !self.chain_injected_proxies.is_empty() {
            let injected: Vec<std::string::String> = self
                .chain_injected_proxies
                .iter()
                .map(|name| name.to_string())
                .collect();
            if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
                let mut index = 0;
                while index < proxies.len() {
                    let is_injected = proxies[index]
                        .get("name")
                        .and_then(|name| name.as_str())
                        .is_some_and(|name| injected.iter().any(|n| n == name));
                    if is_injected {
                        proxies.remove(index);
                    } else {
                        index += 1;
                    }
                }
            }
            self.chain_injected_proxies.clear();
        }

        // 2.5 Remove group members that were injected by a previous chain operation.
        if !self.chain_injected_group_members.is_empty() {
            if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
                for group in groups.iter_mut() {
                    let Some(group_map) = group.as_mapping_mut() else {
                        continue;
                    };
                    let Some(group_name) = group_map.get("name").and_then(|n| n.as_str()) else {
                        continue;
                    };
                    let to_remove: Vec<std::string::String> = self
                        .chain_injected_group_members
                        .iter()
                        .filter(|(g, _)| g.as_str() == group_name)
                        .map(|(_, n)| n.to_string())
                        .collect();
                    if to_remove.is_empty() {
                        continue;
                    }
                    if let Some(Value::Sequence(members)) = group_map.get_mut("proxies") {
                        let mut index = 0;
                        while index < members.len() {
                            let should_remove = members[index]
                                .as_str()
                                .is_some_and(|name| to_remove.iter().any(|n| n == name));
                            if should_remove {
                                members.remove(index);
                            } else {
                                index += 1;
                            }
                        }
                    }
                }
            }
            self.chain_injected_group_members.clear();
        }

        // 3. Inject foreign proxy definitions (e.g. nodes that belong to another
        //    subscription) and collect the ordered list of chain node names.
        let Some(Value::Sequence(chain)) = proxy_chain_config else {
            return;
        };

        let mut ordered_names: Vec<Value> = Vec::with_capacity(chain.len());
        for element in chain.iter() {
            match element {
                // A full proxy definition: make sure it exists in the runtime config.
                Value::Mapping(proxy) => {
                    let Some(name) = proxy.get("name").and_then(|name| name.as_str()) else {
                        continue;
                    };
                    let already_exists = config
                        .get("proxies")
                        .and_then(|proxies| proxies.as_sequence())
                        .is_some_and(|proxies| {
                            proxies
                                .iter()
                                .any(|p| p.get("name").and_then(|n| n.as_str()) == Some(name))
                        });
                    if !already_exists && let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
                        proxies.push(Value::Mapping(proxy.clone()));
                        self.chain_injected_proxies.push(name.into());
                    }
                    ordered_names.push(Value::String(name.into()));
                }
                // A plain name: the node already lives in the runtime config.
                Value::String(name) => {
                    ordered_names.push(Value::String(name.clone()));
                }
                _ => {}
            }
        }

        // 4. Wire up dialer-proxy chaining following the ordered node names.
        if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
            for (i, dialer_proxy) in ordered_names.iter().enumerate() {
                if let Some(Value::Mapping(proxy)) =
                    proxies.iter_mut().find(|proxy| proxy.get("name") == Some(dialer_proxy))
                    && i != 0
                    && let Some(prev) = ordered_names.get(i - 1)
                {
                    let original = proxy.get("dialer-proxy").cloned();
                    if let Some(name) = dialer_proxy.as_str() {
                        self.chain_overwritten_dialer_proxies.push((name.into(), original));
                    }
                    proxy.insert("dialer-proxy".into(), prev.to_owned());
                }
            }
        }

        // 5. Make the chain nodes selectable in proxy-groups.
        //    - If chain_group is specified, inject into that specific group.
        //    - Otherwise (e.g. mode != global and no selected group), inject into
        //      ALL selector-type groups so the chain nodes are always reachable.
        if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
            for group in groups.iter_mut() {
                let Some(group_map) = group.as_mapping_mut() else {
                    continue;
                };

                // Extract group name (owned) to avoid borrow conflicts.
                let Some(group_name_owned) = group_map.get("name").and_then(|n| n.as_str()).map(String::from) else {
                    continue;
                };

                // Determine whether this group is a target.
                let is_target = match &chain_group {
                    Some(target) => group_name_owned == *target,
                    None => {
                        // Fallback: all selector-type groups.
                        let t = group_map
                            .get("type")
                            .and_then(|v| v.as_str())
                            .map(|t| t.to_ascii_lowercase())
                            .unwrap_or_default();
                        t == "select" || t == "selector" || t == "urltest" || t == "url-test" || t == "url_test"
                    }
                };
                if !is_target {
                    continue;
                }

                if group_map.get("proxies").is_none() {
                    group_map.insert("proxies".into(), Value::Sequence(serde_yaml_ng::Sequence::default()));
                }
                let Some(Value::Sequence(members)) = group_map.get_mut("proxies") else {
                    continue;
                };
                for name in ordered_names.iter() {
                    let Some(name_str) = name.as_str() else { continue };
                    let present = members.iter().any(|m| m.as_str() == Some(name_str));
                    if !present {
                        members.push(Value::String(name_str.into()));
                        self.chain_injected_group_members
                            .push((group_name_owned.clone(), name_str.into()));
                    }
                }

                // If targeting a specific group, stop after the first match.
                if chain_group.is_some() {
                    break;
                }
            }
        }
    }

    /// Convert persisted `verge.proxy_chain_nodes` JSON into a runtime chain value.
    /// Returns None when the chain is missing or empty so callers can no-op.
    pub fn persisted_chain_from_json(nodes: Option<&serde_json::Value>) -> Option<Value> {
        let Some(serde_json::Value::Array(items)) = nodes else {
            return None;
        };
        if items.is_empty() {
            return None;
        }
        let seq: serde_yaml_ng::Sequence = items
            .iter()
            .filter_map(|item| {
                let raw = serde_json::to_string(item).ok()?;
                serde_yaml_ng::from_str(&raw).ok()
            })
            .collect();
        if seq.is_empty() {
            None
        } else {
            Some(Value::Sequence(seq))
        }
    }
}

fn restore_overwritten_dialer_proxies(config: &mut Mapping, overwrites: Vec<(String, Option<Value>)>) {
    let Some(Value::Sequence(proxies)) = config.get_mut("proxies") else {
        return;
    };
    for (name, original) in overwrites {
        let Some(Value::Mapping(proxy)) = proxies
            .iter_mut()
            .find(|proxy| proxy.get("name").and_then(Value::as_str) == Some(name.as_str()))
        else {
            continue;
        };
        match original {
            Some(value) => {
                proxy.insert("dialer-proxy".into(), value);
            }
            None => {
                proxy.remove("dialer-proxy");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime_from_yaml(yaml: &str) -> IRuntime {
        IRuntime {
            config: Some(serde_yaml_ng::from_str(yaml).expect("yaml")),
            ..IRuntime::default()
        }
    }

    fn proxy_dialer(runtime: &IRuntime, name: &str) -> Option<std::string::String> {
        runtime
            .config
            .as_ref()
            .and_then(|config| config.get("proxies"))
            .and_then(Value::as_sequence)
            .and_then(|proxies| {
                proxies
                    .iter()
                    .find(|proxy| proxy.get("name").and_then(Value::as_str) == Some(name))
            })
            .and_then(|proxy| proxy.get("dialer-proxy"))
            .and_then(Value::as_str)
            .map(str::to_owned)
    }

    fn chain_names(names: &[&str]) -> Value {
        Value::Sequence(names.iter().map(|name| Value::from(*name)).collect())
    }

    #[test]
    fn empty_chain_keeps_user_dialer_proxy() {
        let mut runtime = runtime_from_yaml(
            r#"
proxies:
  - name: JMS
    type: ss
    server: vpn.example
    port: 443
  - name: Thordata-ISP
    type: http
    server: isp.example
    port: 6666
    dialer-proxy: JMS
  - name: Thordata-ISP-Direct
    type: http
    server: isp.example
    port: 6666
"#,
        );

        runtime.update_proxy_chain_config(None, None);
        assert_eq!(proxy_dialer(&runtime, "Thordata-ISP").as_deref(), Some("JMS"));
        assert_eq!(proxy_dialer(&runtime, "Thordata-ISP-Direct"), None);

        runtime.update_proxy_chain_config(Some(Value::Sequence(vec![])), None);
        assert_eq!(proxy_dialer(&runtime, "Thordata-ISP").as_deref(), Some("JMS"));
    }

    #[test]
    fn clearing_global_chain_restores_user_dialer_proxy() {
        let mut runtime = runtime_from_yaml(
            r#"
proxies:
  - name: JMS-leaf
    type: ss
    server: vpn.example
    port: 443
  - name: Thordata-ISP
    type: http
    server: isp.example
    port: 6666
    dialer-proxy: JMS
  - name: Exit-Only
    type: http
    server: other.example
    port: 8080
"#,
        );

        runtime.update_proxy_chain_config(Some(chain_names(&["JMS-leaf", "Thordata-ISP"])), None);
        assert_eq!(proxy_dialer(&runtime, "Thordata-ISP").as_deref(), Some("JMS-leaf"));
        assert_eq!(proxy_dialer(&runtime, "Exit-Only"), None);

        runtime.update_proxy_chain_config(None, None);
        assert_eq!(proxy_dialer(&runtime, "Thordata-ISP").as_deref(), Some("JMS"));
        assert_eq!(proxy_dialer(&runtime, "Exit-Only"), None);
    }

    #[test]
    fn clearing_global_chain_removes_only_injected_dialer_proxy() {
        let mut runtime = runtime_from_yaml(
            r#"
proxies:
  - name: entry
    type: ss
    server: a.example
    port: 443
  - name: exit
    type: ss
    server: b.example
    port: 443
  - name: Thordata-ISP
    type: http
    server: isp.example
    port: 6666
    dialer-proxy: JMS
"#,
        );

        runtime.update_proxy_chain_config(Some(chain_names(&["entry", "exit"])), None);
        assert_eq!(proxy_dialer(&runtime, "exit").as_deref(), Some("entry"));
        assert_eq!(proxy_dialer(&runtime, "Thordata-ISP").as_deref(), Some("JMS"));

        runtime.update_proxy_chain_config(None, None);
        assert_eq!(proxy_dialer(&runtime, "exit"), None);
        assert_eq!(proxy_dialer(&runtime, "Thordata-ISP").as_deref(), Some("JMS"));
    }

    #[test]
    fn persisted_chain_from_json_skips_empty() {
        assert!(IRuntime::persisted_chain_from_json(None).is_none());
        assert!(IRuntime::persisted_chain_from_json(Some(&serde_json::json!([]))).is_none());
        let chain = IRuntime::persisted_chain_from_json(Some(&serde_json::json!(["JMS", "Thordata-ISP"])));
        let names: Vec<_> = chain
            .and_then(|value| value.as_sequence().cloned())
            .unwrap()
            .into_iter()
            .filter_map(|value| value.as_str().map(str::to_owned))
            .collect();
        assert_eq!(names, vec!["JMS".to_string(), "Thordata-ISP".to_string()]);
    }
}
