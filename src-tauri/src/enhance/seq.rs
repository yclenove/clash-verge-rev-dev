use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Sequence, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SeqMap {
    pub prepend: Sequence,
    pub append: Sequence,
    pub delete: Vec<String>,
}

fn collect_proxy_names(seq: &Sequence) -> Vec<String> {
    seq.iter()
        .filter_map(|item| match item {
            Value::Mapping(map) => map.get("name").and_then(Value::as_str).map(str::to_owned),
            Value::String(name) => Some(name.to_owned()),
            _ => None,
        })
        .collect()
}

fn is_selector_group(group_map: &Mapping) -> bool {
    group_map
        .get("type")
        .and_then(Value::as_str)
        .map(|value| {
            let value = value.to_ascii_lowercase();
            value == "select" || value == "selector" || value == "urltest" || value == "url-test" || value == "url_test"
        })
        .unwrap_or(false)
}

fn is_urltest_group(group_map: &Mapping) -> bool {
    group_map
        .get("type")
        .and_then(Value::as_str)
        .map(|value| {
            let value = value.to_ascii_lowercase();
            value == "urltest" || value == "url-test" || value == "url_test"
        })
        .unwrap_or(false)
}

fn collect_proxy_dialers(seq: &Sequence) -> HashMap<String, String> {
    let mut dialers = HashMap::new();
    for item in seq {
        let Value::Mapping(map) = item else {
            continue;
        };
        let Some(name) = map.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(dialer) = map.get("dialer-proxy").and_then(Value::as_str) else {
            continue;
        };
        if !dialer.is_empty() {
            dialers.insert(name.to_owned(), dialer.to_owned());
        }
    }
    dialers
}

fn group_name_and_members(group: &Value) -> Option<(String, Vec<String>)> {
    let map = group.as_mapping()?;
    let name = map.get("name").and_then(Value::as_str)?.to_owned();
    let members = map
        .get("proxies")
        .and_then(Value::as_sequence)
        .map(|seq| {
            seq.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Some((name, members))
}

fn forbidden_groups_for_dialers(proxy_groups: &Sequence, added_dialers: &HashMap<String, String>) -> HashSet<String> {
    if added_dialers.is_empty() {
        return HashSet::new();
    }

    let mut members_by_group: HashMap<String, Vec<String>> = HashMap::new();
    let mut group_names = HashSet::new();
    for group in proxy_groups {
        if let Some((name, members)) = group_name_and_members(group) {
            group_names.insert(name.clone());
            members_by_group.insert(name, members);
        }
    }

    let mut forbidden: HashSet<String> = added_dialers
        .values()
        .filter(|name| group_names.contains(*name))
        .cloned()
        .collect();
    let mut stack: Vec<String> = forbidden.iter().cloned().collect();
    while let Some(name) = stack.pop() {
        let Some(members) = members_by_group.get(&name) else {
            continue;
        };
        for member in members {
            if group_names.contains(member) && forbidden.insert(member.clone()) {
                stack.push(member.clone());
            }
        }
    }
    forbidden
}

pub fn use_seq(seq: SeqMap, mut config: Mapping, field: &str) -> Mapping {
    let SeqMap {
        prepend,
        append,
        delete,
    } = seq;

    let (added_proxy_names, added_proxy_dialers) = if field == "proxies" {
        let mut names = collect_proxy_names(&prepend);
        names.extend(collect_proxy_names(&append));
        let mut seen = HashSet::new();
        let names = names
            .into_iter()
            .filter(|name| seen.insert(name.clone()))
            .collect::<Vec<String>>();
        let mut dialers = collect_proxy_dialers(&prepend);
        dialers.extend(collect_proxy_dialers(&append));
        (names, dialers)
    } else {
        (Vec::new(), HashMap::new())
    };

    let mut updated_items = Sequence::new();
    updated_items.extend(prepend);

    if let Some(Value::Sequence(existing_items)) = config.remove(field) {
        // Filter out deleted items
        let kept_items: Sequence = existing_items
            .into_iter()
            .filter(|item| {
                if let Value::String(s) = item {
                    !delete.contains(s)
                } else if let Value::Mapping(m) = item {
                    if let Some(Value::String(name)) = m.get("name") {
                        !delete.contains(name)
                    } else {
                        true
                    }
                } else {
                    true
                }
            })
            .collect();
        updated_items.extend(kept_items);
    }

    updated_items.extend(append);
    config.insert(Value::String(field.into()), Value::Sequence(updated_items));

    if field != "proxies" {
        return config;
    }

    let Some(proxy_groups_value) = config.remove("proxy-groups") else {
        return config;
    };

    let Value::Sequence(proxy_groups) = proxy_groups_value else {
        config.insert(Value::String("proxy-groups".into()), proxy_groups_value);
        return config;
    };

    let forbidden_groups = forbidden_groups_for_dialers(&proxy_groups, &added_proxy_dialers);

    let mut updated_groups = Sequence::new();
    for group in proxy_groups {
        if let Value::Mapping(mut group_map) = group {
            let mut group_proxies = match group_map.remove("proxies") {
                Some(Value::Sequence(proxies)) => Some(
                    proxies
                        .into_iter()
                        .filter(|p| {
                            if let Value::String(name) = p {
                                !delete.contains(name)
                            } else {
                                true
                            }
                        })
                        .collect::<Sequence>(),
                ),
                Some(value) => {
                    group_map.insert(Value::String("proxies".into()), value);
                    None
                }
                None => None,
            };

            if !added_proxy_names.is_empty() && is_selector_group(&group_map) {
                let group_name = group_map.get("name").and_then(Value::as_str).unwrap_or_default();
                let skip_all_added = forbidden_groups.contains(group_name);
                let skip_dialer_nodes = is_urltest_group(&group_map);
                let names_to_inject = added_proxy_names.iter().filter(|name| {
                    if skip_all_added {
                        return false;
                    }
                    match added_proxy_dialers.get(*name) {
                        Some(dialer) if skip_dialer_nodes || dialer == group_name => false,
                        _ => true,
                    }
                });
                let base_group_proxies = group_proxies.unwrap_or_else(Sequence::new);
                let mut merged_proxies = Sequence::new();
                let mut seen_proxy_names = HashSet::new();
                for name in names_to_inject {
                    if seen_proxy_names.insert(name.clone()) {
                        merged_proxies.push(Value::String(name.clone()));
                    }
                }
                for value in base_group_proxies {
                    if let Value::String(name) = &value
                        && !seen_proxy_names.insert(name.to_owned())
                    {
                        continue;
                    }

                    merged_proxies.push(value);
                }
                group_proxies = Some(merged_proxies);
            }

            if let Some(group_proxies) = group_proxies {
                group_map.insert(Value::String("proxies".into()), Value::Sequence(group_proxies));
            }
            updated_groups.push(Value::Mapping(group_map));
        } else {
            updated_groups.push(group);
        }
    }
    config.insert(Value::String("proxy-groups".into()), Value::Sequence(updated_groups));

    config
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use serde_yaml_ng::Value;

    #[test]
    #[allow(clippy::unwrap_used)]
    #[allow(clippy::expect_used)]
    fn test_delete_proxy_and_references() {
        let config_str = r#"
proxies:
- name: "proxy1"
  type: "ss"
- name: "proxy2"
  type: "vmess"
proxy-groups:
- name: "group1"
  type: "select"
  proxies:
    - "proxy1"
    - "proxy2"
- name: "group2"
  type: "select"
  proxies:
    - "proxy1"
"#;
        let mut config: Mapping = serde_yaml_ng::from_str(config_str).expect("Failed to parse test config YAML");

        let seq = SeqMap {
            prepend: Sequence::new(),
            append: Sequence::new(),
            delete: vec!["proxy1".to_string()],
        };

        config = use_seq(seq, config, "proxies");

        // Check if proxy1 is removed from proxies
        let proxies = config
            .get("proxies")
            .expect("proxies field should exist")
            .as_sequence()
            .expect("proxies should be a sequence");
        assert_eq!(proxies.len(), 1);
        assert_eq!(
            proxies[0]
                .as_mapping()
                .expect("proxy should be a mapping")
                .get("name")
                .expect("proxy should have name")
                .as_str()
                .expect("name should be string"),
            "proxy2"
        );

        // Check if proxy1 is removed from all groups
        let groups = config
            .get("proxy-groups")
            .expect("proxy-groups field should exist")
            .as_sequence()
            .expect("proxy-groups should be a sequence");
        let group1_proxies = groups[0]
            .as_mapping()
            .expect("group should be a mapping")
            .get("proxies")
            .expect("group should have proxies")
            .as_sequence()
            .expect("group proxies should be a sequence");
        let group2_proxies = groups[1]
            .as_mapping()
            .expect("group should be a mapping")
            .get("proxies")
            .expect("group should have proxies")
            .as_sequence()
            .expect("group proxies should be a sequence");

        assert_eq!(group1_proxies.len(), 1);
        assert_eq!(
            group1_proxies[0].as_str().expect("proxy name should be string"),
            "proxy2"
        );
        assert_eq!(group2_proxies.len(), 0);
    }

    #[test]
    #[allow(clippy::unwrap_used)]
    #[allow(clippy::expect_used)]
    fn test_add_new_proxies_to_all_selector_groups() {
        let config_str = r#"
proxies:
- name: "proxy1"
  type: "ss"
proxy-groups:
- name: "group1"
  type: "select"
  proxies:
    - "proxy1"
- name: "group2"
  type: "select"
  proxies:
    - "proxy1"
"#;
        let mut config: Mapping = serde_yaml_ng::from_str(config_str).expect("Failed to parse test config YAML");

        let prepend: Sequence = serde_yaml_ng::from_str(
            r#"
- name: "proxy3"
  type: "ss"
"#,
        )
        .expect("Failed to parse prepend proxies");

        let append: Sequence = serde_yaml_ng::from_str(
            r#"
- name: "proxy4"
  type: "vmess"
"#,
        )
        .expect("Failed to parse append proxies");

        let seq = SeqMap {
            prepend,
            append,
            delete: vec![],
        };

        config = use_seq(seq, config, "proxies");

        let groups = config
            .get("proxy-groups")
            .expect("proxy-groups field should exist")
            .as_sequence()
            .expect("proxy-groups should be a sequence");
        let group1_proxies = groups[0]
            .as_mapping()
            .expect("group should be a mapping")
            .get("proxies")
            .expect("group should have proxies")
            .as_sequence()
            .expect("group proxies should be a sequence");
        let names: Vec<&str> = group1_proxies.iter().filter_map(Value::as_str).collect();
        assert_eq!(names, vec!["proxy3", "proxy4", "proxy1"]);

        let group2_proxies = groups[1]
            .as_mapping()
            .expect("group should be a mapping")
            .get("proxies")
            .expect("group should have proxies")
            .as_sequence()
            .expect("group proxies should be a sequence");
        let names: Vec<&str> = group2_proxies.iter().filter_map(Value::as_str).collect();
        assert_eq!(names, vec!["proxy3", "proxy4", "proxy1"]);
    }

    #[test]
    #[allow(clippy::unwrap_used)]
    #[allow(clippy::expect_used)]
    fn test_skip_dialer_proxy_nodes_from_hop_groups() {
        let config_str = r#"
proxies:
- name: "JMS-leaf"
  type: "ss"
proxy-groups:
- name: "JMS"
  type: "select"
  proxies:
    - "JMS Auto"
    - "JMS-leaf"
- name: "JMS Auto"
  type: "url-test"
  proxies:
    - "JMS-leaf"
- name: "OTHER"
  type: "select"
  proxies:
    - "JMS-leaf"
"#;
        let mut config: Mapping = serde_yaml_ng::from_str(config_str).expect("Failed to parse test config YAML");

        let append: Sequence = serde_yaml_ng::from_str(
            r#"
- name: "Thordata-ISP"
  type: "http"
  server: "isp.example"
  port: 6666
  dialer-proxy: "JMS"
- name: "Thordata-ISP-Direct"
  type: "http"
  server: "isp.example"
  port: 6666
"#,
        )
        .expect("Failed to parse append proxies");

        let seq = SeqMap {
            prepend: Sequence::new(),
            append,
            delete: vec![],
        };

        config = use_seq(seq, config, "proxies");

        let groups = config
            .get("proxy-groups")
            .expect("proxy-groups field should exist")
            .as_sequence()
            .expect("proxy-groups should be a sequence");

        let names_of = |index: usize| -> Vec<&str> {
            groups[index]
                .as_mapping()
                .expect("group should be a mapping")
                .get("proxies")
                .expect("group should have proxies")
                .as_sequence()
                .expect("group proxies should be a sequence")
                .iter()
                .filter_map(Value::as_str)
                .collect()
        };

        assert_eq!(names_of(0), vec!["JMS Auto", "JMS-leaf"]);
        assert_eq!(names_of(1), vec!["JMS-leaf"]);
        assert_eq!(names_of(2), vec!["Thordata-ISP", "Thordata-ISP-Direct", "JMS-leaf"]);
    }

    #[test]
    #[allow(clippy::unwrap_used)]
    #[allow(clippy::expect_used)]
    fn test_preserve_non_sequence_proxy_groups() {
        let config_str = r#"
proxies:
- name: "proxy1"
  type: "ss"
proxy-groups: "invalid"
"#;
        let mut config: Mapping = serde_yaml_ng::from_str(config_str).expect("Failed to parse test config YAML");

        let seq = SeqMap {
            prepend: Sequence::new(),
            append: Sequence::new(),
            delete: vec!["proxy1".to_string()],
        };

        config = use_seq(seq, config, "proxies");

        assert_eq!(config.get("proxy-groups").and_then(Value::as_str), Some("invalid"));
    }
}
