use compact_str::CompactString;
use std::collections::VecDeque;
use tokio::sync::RwLock;

/// Number of core log lines retained for the Logs page.
///
/// The frontend caps its visible buffer at 1000 entries; keeping the same
/// capacity here prevents an INFO-heavy core from evicting recent
/// warning/error lines before the user opens the Logs page.
const LOGS_QUEUE_LEN: usize = 1000;

pub struct ClashLogBuffer {
    inner: RwLock<VecDeque<CompactString>>,
}

impl ClashLogBuffer {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(VecDeque::with_capacity(LOGS_QUEUE_LEN)),
        }
    }

    pub async fn append_log(&self, log: CompactString) {
        let mut guard = self.inner.write().await;
        if guard.len() == LOGS_QUEUE_LEN {
            guard.pop_front();
        }
        guard.push_back(log);
    }

    pub async fn get_logs(&self) -> Vec<CompactString> {
        self.inner.read().await.iter().cloned().collect()
    }

    pub async fn clear_logs(&self) {
        self.inner.write().await.clear();
    }
}

impl Default for ClashLogBuffer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn keeps_only_the_latest_lines() {
        let buffer = ClashLogBuffer::new();
        for i in 0..LOGS_QUEUE_LEN + 10 {
            buffer.append_log(CompactString::from(format!("line {i}"))).await;
        }

        let logs = buffer.get_logs().await;
        assert_eq!(logs.len(), LOGS_QUEUE_LEN);
        assert_eq!(logs.first().map(|s| s.as_str()), Some("line 10"));
        let expected = format!("line {}", LOGS_QUEUE_LEN + 9);
        assert_eq!(logs.last().map(|s| s.as_str()), Some(expected.as_str()));
    }

    #[tokio::test]
    async fn clear_drops_all_lines() {
        let buffer = ClashLogBuffer::new();
        buffer.append_log(CompactString::from("hello")).await;

        buffer.clear_logs().await;

        assert!(buffer.get_logs().await.is_empty());
    }

    #[tokio::test]
    async fn keeps_warning_lines_within_the_visible_window() {
        let buffer = ClashLogBuffer::new();
        for i in 0..50 {
            buffer.append_log(CompactString::from(format!("line {i}"))).await;
        }
        buffer
            .append_log(CompactString::from("line 50 level=warning msg=\"something\""))
            .await;
        for i in 51..LOGS_QUEUE_LEN {
            buffer.append_log(CompactString::from(format!("line {i}"))).await;
        }

        let logs = buffer.get_logs().await;
        assert!(logs.iter().any(|line| line.contains("level=warning")));

        // Warning sits at index 50; evicting it requires 51 additional lines.
        for i in LOGS_QUEUE_LEN..LOGS_QUEUE_LEN + 51 {
            buffer.append_log(CompactString::from(format!("line {i}"))).await;
        }

        let logs = buffer.get_logs().await;
        assert!(!logs.iter().any(|line| line.contains("level=warning")));
    }
}
