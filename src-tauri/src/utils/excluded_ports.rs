use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExcludedPortRanges {
    ranges: Vec<(u16, u16)>,
}

impl ExcludedPortRanges {
    pub fn from_ranges(mut ranges: Vec<(u16, u16)>) -> Self {
        ranges.sort_unstable();
        ranges.dedup();
        Self { ranges }
    }

    pub fn contains(&self, port: u16) -> bool {
        self.ranges.iter().any(|&(start, end)| port >= start && port <= end)
    }

    pub const fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }
}

static CACHE: Lazy<Mutex<Option<(Instant, ExcludedPortRanges)>>> = Lazy::new(|| Mutex::new(None));

pub fn system_excluded_port_ranges() -> ExcludedPortRanges {
    let now = Instant::now();
    let mut cache = CACHE.lock();
    if let Some((fetched_at, ranges)) = cache.as_ref()
        && now.saturating_duration_since(*fetched_at) < CACHE_TTL
    {
        return ranges.clone();
    }
    let ranges = query_system_excluded_port_ranges();
    *cache = Some((now, ranges.clone()));
    ranges
}

pub fn query_system_excluded_port_ranges() -> ExcludedPortRanges {
    #[cfg(windows)]
    {
        let mut ranges = Vec::new();
        for (iface, proto) in [("ipv4", "tcp"), ("ipv4", "udp"), ("ipv6", "tcp"), ("ipv6", "udp")] {
            ranges.extend(query_netsh_excludedportrange(iface, proto));
        }
        ExcludedPortRanges::from_ranges(ranges)
    }
    #[cfg(not(windows))]
    ExcludedPortRanges::default()
}

pub fn parse_netsh_excludedportrange(output: &str) -> Vec<(u16, u16)> {
    let mut ranges = Vec::new();
    for line in output.lines() {
        let mut numbers = line.split_whitespace().filter_map(|token| {
            if token.chars().all(|ch| ch.is_ascii_digit()) {
                token.parse::<u16>().ok()
            } else {
                None
            }
        });
        let Some(start) = numbers.next() else {
            continue;
        };
        let Some(end) = numbers.next() else {
            continue;
        };
        if start == 0 || end == 0 || start > end {
            continue;
        }
        ranges.push((start, end));
    }
    ranges
}

#[cfg(windows)]
fn query_netsh_excludedportrange(iface: &str, proto: &str) -> Vec<(u16, u16)> {
    use std::os::windows::process::CommandExt as _;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new("netsh")
        .args([
            "interface",
            iface,
            "show",
            "excludedportrange",
            &format!("protocol={proto}"),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_netsh_excludedportrange(&stdout)
}

#[cfg(test)]
mod tests {
    use super::{ExcludedPortRanges, parse_netsh_excludedportrange};

    #[test]
    fn parse_skips_headers_and_keeps_ranges() {
        let output = "\
Protocol tcp Port Exclusion Ranges\n\
\n\
Start Port    End Port\n\
----------    --------\n\
     10522       10621\n\
     10914       11013\n\
     50000       50059     *\n";
        let ranges = parse_netsh_excludedportrange(output);
        assert!(ranges.contains(&(10522, 10621)));
        assert!(ranges.contains(&(10914, 11013)));
        assert!(ranges.contains(&(50000, 50059)));
    }

    #[test]
    fn contains_covers_inclusive_bounds() {
        let ranges = ExcludedPortRanges::from_ranges(vec![(10914, 11013)]);
        assert!(!ranges.contains(10913));
        assert!(ranges.contains(10914));
        assert!(ranges.contains(10954));
        assert!(ranges.contains(11013));
        assert!(!ranges.contains(11014));
    }

    #[test]
    fn empty_ranges_never_match() {
        assert!(!ExcludedPortRanges::default().contains(10808));
    }
}
