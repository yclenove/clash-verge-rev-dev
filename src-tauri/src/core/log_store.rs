#![allow(
    clippy::clone_on_ref_ptr,
    clippy::expect_used,
    clippy::significant_drop_tightening,
    clippy::type_complexity,
    clippy::unwrap_used
)]

use crate::utils::dirs;
use anyhow::{Context as _, Result};
use chrono::{DateTime, Local, NaiveDateTime, TimeZone as _};
use once_cell::sync::OnceCell;
use regex::Regex;
use rusqlite::{Connection, OptionalExtension as _, params, params_from_iter};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque, hash_map::DefaultHasher},
    hash::{Hash as _, Hasher as _},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex as StdMutex, OnceLock,
        atomic::{AtomicBool, AtomicI64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, Notify};

const LOG_QUEUE_CAP: usize = 4096;
const LOG_BATCH_MAX: usize = 500;
const FLUSH_INTERVAL: Duration = Duration::from_millis(100);
const RETENTION_PRUNE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const DEFAULT_RETENTION_DAYS: i64 = 7;
const RAW_TRAFFIC_RETENTION_DAYS: i64 = 3;
const DEFAULT_MAX_DB_BYTES: u64 = 200 * 1024 * 1024;
const SIZE_CAP_DELETE_BATCH: i64 = 20;
const MAX_QUERY_LIMIT: i64 = 1_001;

static LOG_STORE: OnceLock<Arc<SqliteLogStore>> = OnceLock::new();
static LOG_STORE_INIT: StdMutex<()> = StdMutex::new(());

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub id: i64,
    pub ts: i64,
    pub level: String,
    pub source: String,
    pub payload: String,
}

impl LogEntry {
    pub(crate) fn new(
        ts: i64,
        level: impl Into<String>,
        source: impl Into<String>,
        payload: impl Into<String>,
    ) -> Self {
        Self {
            id: 0,
            ts,
            level: level.into(),
            source: source.into(),
            payload: payload.into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct LogPage {
    pub entries: Vec<LogEntry>,
    pub total: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct LogQuery {
    pub from_ts: Option<i64>,
    pub to_ts: Option<i64>,
    pub level: Option<String>,
    pub source: Option<String>,
    pub limit: Option<i64>,
    pub cursor_ts: Option<i64>,
    pub cursor_id: Option<i64>,
    pub descending: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionEntry {
    pub connection_id: String,
    pub started_at: i64,
    #[serde(default)]
    pub observed_at: Option<i64>,
    pub closed_at: Option<i64>,
    pub process: Option<String>,
    pub host: Option<String>,
    pub ip: Option<String>,
    pub port: Option<i64>,
    pub source_port: Option<i64>,
    pub destination_port: Option<i64>,
    pub rule: Option<String>,
    pub proxy: Option<String>,
    pub upload: i64,
    pub download: i64,
    pub confidence: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrafficBucket {
    pub date: String,
    pub process: String,
    pub host: String,
    pub ip: String,
    pub proxy: String,
    pub upload: i64,
    pub download: i64,
    pub connection_count: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct TrafficTotals {
    pub today_upload: i64,
    pub today_download: i64,
    pub total_upload: i64,
    pub total_download: i64,
}

pub struct SqliteLogStore {
    writer: Mutex<Connection>,
    reader: Mutex<Connection>,
    queue: StdMutex<VecDeque<LogEntry>>,
    notify: Notify,
    retention_days: i64,
    max_db_bytes: u64,
    db_path: PathBuf,
    service_snapshot_imported: AtomicBool,
    cleared_at: AtomicI64,
}

const LOG_PARTITION_TABLES: [&str; 5] = ["logs_debug", "logs_info", "logs_warning", "logs_error", "logs_other"];

const LOG_UNION_SELECT: &str = "
SELECT id, ts, level, source, payload FROM logs_debug
UNION ALL
SELECT id, ts, level, source, payload FROM logs_info
UNION ALL
SELECT id, ts, level, source, payload FROM logs_warning
UNION ALL
SELECT id, ts, level, source, payload FROM logs_error
UNION ALL
SELECT id, ts, level, source, payload FROM logs_other
";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS log_id_sequence (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  next_id INTEGER NOT NULL
);
INSERT OR IGNORE INTO log_id_sequence (singleton, next_id) VALUES (1, 1);

CREATE TABLE IF NOT EXISTS logs_debug (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  raw TEXT NOT NULL,
  raw_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_logs_debug_source_ts_hash
  ON logs_debug(source, ts, raw_hash);
CREATE INDEX IF NOT EXISTS idx_logs_debug_ts ON logs_debug(ts, id);
CREATE INDEX IF NOT EXISTS idx_logs_debug_source_ts ON logs_debug(source, ts, id);

CREATE TABLE IF NOT EXISTS logs_info (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  raw TEXT NOT NULL,
  raw_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_logs_info_source_ts_hash
  ON logs_info(source, ts, raw_hash);
CREATE INDEX IF NOT EXISTS idx_logs_info_ts ON logs_info(ts, id);
CREATE INDEX IF NOT EXISTS idx_logs_info_source_ts ON logs_info(source, ts, id);

CREATE TABLE IF NOT EXISTS logs_warning (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  raw TEXT NOT NULL,
  raw_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_logs_warning_source_ts_hash
  ON logs_warning(source, ts, raw_hash);
CREATE INDEX IF NOT EXISTS idx_logs_warning_ts ON logs_warning(ts, id);
CREATE INDEX IF NOT EXISTS idx_logs_warning_source_ts ON logs_warning(source, ts, id);

CREATE TABLE IF NOT EXISTS logs_error (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  raw TEXT NOT NULL,
  raw_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_logs_error_source_ts_hash
  ON logs_error(source, ts, raw_hash);
CREATE INDEX IF NOT EXISTS idx_logs_error_ts ON logs_error(ts, id);
CREATE INDEX IF NOT EXISTS idx_logs_error_source_ts ON logs_error(source, ts, id);

CREATE TABLE IF NOT EXISTS logs_other (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  raw TEXT NOT NULL,
  raw_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_logs_other_source_ts_hash
  ON logs_other(source, ts, raw_hash);
CREATE INDEX IF NOT EXISTS idx_logs_other_ts ON logs_other(ts, id);
CREATE INDEX IF NOT EXISTS idx_logs_other_source_ts ON logs_other(source, ts, id);
CREATE INDEX IF NOT EXISTS idx_logs_other_level_ts ON logs_other(level, ts, id);

CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  closed_at INTEGER,
  process TEXT,
  host TEXT,
  ip TEXT,
  port INTEGER,
  source_port INTEGER,
  destination_port INTEGER,
  rule TEXT,
  proxy TEXT,
  upload INTEGER NOT NULL DEFAULT 0,
  download INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'high',
  last_seen_at INTEGER NOT NULL,
  identity_checked_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_id
  ON connections(connection_id);
CREATE INDEX IF NOT EXISTS idx_connections_started
  ON connections(started_at);
CREATE INDEX IF NOT EXISTS idx_connections_host_ip
  ON connections(host, ip);
CREATE INDEX IF NOT EXISTS idx_connections_process
  ON connections(process, started_at);
CREATE INDEX IF NOT EXISTS idx_connections_ports
  ON connections(source_port, destination_port);
CREATE TABLE IF NOT EXISTS traffic_daily_details (
  day TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  process TEXT,
  host TEXT,
  ip TEXT,
  proxy TEXT,
  upload INTEGER NOT NULL DEFAULT 0,
  download INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, connection_id)
);
CREATE INDEX IF NOT EXISTS idx_traffic_daily_details_day
  ON traffic_daily_details(day);
CREATE INDEX IF NOT EXISTS idx_traffic_daily_details_connection
  ON traffic_daily_details(connection_id);
CREATE INDEX IF NOT EXISTS idx_traffic_daily_details_process
  ON traffic_daily_details(process, day);
CREATE INDEX IF NOT EXISTS idx_traffic_daily_details_host
  ON traffic_daily_details(host, ip, day);

CREATE TABLE IF NOT EXISTS traffic_totals (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  upload INTEGER NOT NULL DEFAULT 0,
  download INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO traffic_totals (id, upload, download) VALUES (1, 0, 0);

CREATE TABLE IF NOT EXISTS traffic_daily (
  day TEXT PRIMARY KEY,
  upload INTEGER NOT NULL DEFAULT 0,
  download INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS traffic_daily_dimensions (
  day TEXT NOT NULL,
  process TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  proxy TEXT NOT NULL DEFAULT '',
  upload INTEGER NOT NULL DEFAULT 0,
  download INTEGER NOT NULL DEFAULT 0,
  connection_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, process, host, ip, proxy)
);
CREATE INDEX IF NOT EXISTS idx_traffic_dimensions_day
  ON traffic_daily_dimensions(day);

CREATE TABLE IF NOT EXISTS log_backfill_checkpoints (
  path TEXT PRIMARY KEY,
  modified_ms INTEGER NOT NULL,
  size INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS log_clear_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  cleared_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO log_clear_state (singleton, cleared_at) VALUES (1, 0);
";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn local_day(timestamp_ms: i64) -> String {
    Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .unwrap_or_else(Local::now)
        .format("%Y-%m-%d")
        .to_string()
}

fn hash_raw(raw: &str) -> String {
    let mut hasher = DefaultHasher::new();
    raw.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![name],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn log_partition_table(level: &str) -> &'static str {
    match normalize_stored_log_level(level).as_str() {
        "debug" => "logs_debug",
        "info" => "logs_info",
        "warning" => "logs_warning",
        "error" | "fatal" | "critical" => "logs_error",
        _ => "logs_other",
    }
}

fn log_partition_insert_sql(level: &str) -> &'static str {
    match log_partition_table(level) {
        "logs_debug" => {
            "INSERT OR IGNORE INTO logs_debug
             (id, ts, level, source, payload, raw, raw_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        }
        "logs_info" => {
            "INSERT OR IGNORE INTO logs_info
             (id, ts, level, source, payload, raw, raw_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        }
        "logs_warning" => {
            "INSERT OR IGNORE INTO logs_warning
             (id, ts, level, source, payload, raw, raw_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        }
        "logs_error" => {
            "INSERT OR IGNORE INTO logs_error
             (id, ts, level, source, payload, raw, raw_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        }
        _ => {
            "INSERT OR IGNORE INTO logs_other
             (id, ts, level, source, payload, raw, raw_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        }
    }
}

fn migrate_legacy_log_table(conn: &Connection) -> Result<()> {
    if !table_exists(conn, "logs")? {
        return Ok(());
    }
    conn.execute_batch(
        "INSERT OR IGNORE INTO logs_debug (id, ts, level, source, payload, raw, raw_hash)
         SELECT id, ts, 'debug', source, payload, raw, raw_hash FROM logs
         WHERE lower(trim(level)) = 'debug';

         INSERT OR IGNORE INTO logs_info (id, ts, level, source, payload, raw, raw_hash)
         SELECT id, ts, 'info', source, payload, raw, raw_hash FROM logs
         WHERE lower(trim(level)) IN ('inf', 'info');

         INSERT OR IGNORE INTO logs_warning (id, ts, level, source, payload, raw, raw_hash)
         SELECT id, ts, 'warning', source, payload, raw, raw_hash FROM logs
         WHERE lower(trim(level)) IN ('warn', 'warning');

         INSERT OR IGNORE INTO logs_error (id, ts, level, source, payload, raw, raw_hash)
         SELECT id, ts, 'error', source, payload, raw, raw_hash FROM logs
         WHERE lower(trim(level)) IN ('err', 'error');

         INSERT OR IGNORE INTO logs_other (id, ts, level, source, payload, raw, raw_hash)
         SELECT id, ts, lower(trim(level)), source, payload, raw, raw_hash FROM logs
         WHERE lower(trim(level)) NOT IN ('debug', 'inf', 'info', 'warn', 'warning', 'err', 'error');

         DROP TABLE logs;",
    )
    .context("migrate legacy log table into level partitions")?;
    Ok(())
}

fn reconcile_log_id_sequence(conn: &Connection) -> Result<()> {
    let max_id = conn.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM (
           SELECT id FROM logs_debug
           UNION ALL SELECT id FROM logs_info
           UNION ALL SELECT id FROM logs_warning
           UNION ALL SELECT id FROM logs_error
           UNION ALL SELECT id FROM logs_other
         )",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    conn.execute(
        "UPDATE log_id_sequence
         SET next_id = MAX(next_id, ?1)
         WHERE singleton = 1",
        params![max_id.saturating_add(1)],
    )?;
    Ok(())
}

fn should_persist_log_level(level: &str) -> bool {
    matches!(
        normalize_stored_log_level(level).as_str(),
        "warning" | "error" | "fatal" | "critical"
    )
}

fn sqlite_sidecar_bytes(path: &Path) -> u64 {
    let mut total = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    let wal = PathBuf::from(format!("{}-wal", path.display()));
    let shm = PathBuf::from(format!("{}-shm", path.display()));
    total += std::fs::metadata(&wal).map(|meta| meta.len()).unwrap_or(0);
    total += std::fs::metadata(&shm).map(|meta| meta.len()).unwrap_or(0);
    total
}

fn sqlite_used_bytes(conn: &Connection) -> Result<u64> {
    let page_count: i64 = conn.query_row("PRAGMA page_count", [], |row| row.get(0))?;
    let page_size: i64 = conn.query_row("PRAGMA page_size", [], |row| row.get(0))?;
    let freelist: i64 = conn.query_row("PRAGMA freelist_count", [], |row| row.get(0))?;
    Ok(((page_count - freelist).max(0) as u64) * (page_size.max(0) as u64))
}

fn purge_non_persisted_levels(conn: &Connection) -> Result<usize> {
    let mut deleted = 0usize;
    deleted += conn.execute("DELETE FROM logs_debug", [])?;
    deleted += conn.execute("DELETE FROM logs_info", [])?;
    deleted += conn.execute("DELETE FROM logs_other", [])?;
    Ok(deleted)
}

fn delete_oldest_log_batch(conn: &Connection, limit: i64) -> Result<usize> {
    let mut deleted = 0usize;
    for table in ["logs_warning", "logs_error"] {
        deleted += conn.execute(
            &format!("DELETE FROM {table} WHERE id IN (SELECT id FROM {table} ORDER BY ts ASC, id ASC LIMIT ?1)"),
            params![limit],
        )?;
    }
    Ok(deleted)
}

fn delete_oldest_connection_batch(conn: &Connection, limit: i64) -> Result<usize> {
    Ok(conn.execute(
        "DELETE FROM connections WHERE connection_id IN (
            SELECT connection_id FROM connections ORDER BY last_seen_at ASC, started_at ASC LIMIT ?1
         )",
        params![limit],
    )?)
}

fn reclaim_sqlite_space(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA incremental_vacuum; PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}

fn enforce_size_cap_on_conn(conn: &Connection, path: &Path, max_db_bytes: u64) -> Result<()> {
    if max_db_bytes == 0 {
        return Ok(());
    }
    for _ in 0..1024 {
        if sqlite_used_bytes(conn)? <= max_db_bytes {
            break;
        }
        let mut deleted = delete_oldest_log_batch(conn, SIZE_CAP_DELETE_BATCH)?;
        if deleted == 0 {
            deleted = delete_oldest_connection_batch(conn, SIZE_CAP_DELETE_BATCH)?;
        }
        if deleted == 0 {
            break;
        }
    }
    reclaim_sqlite_space(conn)?;
    if sqlite_sidecar_bytes(path) > max_db_bytes {
        conn.execute_batch("VACUUM")?;
    }
    Ok(())
}

impl SqliteLogStore {
    pub fn open(path: &Path, retention_days: i64) -> Result<Arc<Self>> {
        Self::open_with_limits(path, retention_days, DEFAULT_MAX_DB_BYTES)
    }

    pub fn open_with_limits(path: &Path, retention_days: i64, max_db_bytes: u64) -> Result<Arc<Self>> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("create log db parent dir")?;
        }
        let writer = Connection::open(path).context("open sqlite log db")?;
        let reader = Connection::open(path).context("open sqlite log db reader")?;
        let had_traffic_daily_details = table_exists(&writer, "traffic_daily_details")?;
        let had_traffic_dimensions = table_exists(&writer, "traffic_daily_dimensions")?;
        for conn in [&writer, &reader] {
            conn.pragma_update(None, "journal_mode", "WAL")
                .context("enable sqlite WAL")?;
            conn.busy_timeout(Duration::from_secs(5))
                .context("set sqlite busy timeout")?;
            conn.pragma_update(None, "synchronous", "NORMAL")
                .context("set sqlite synchronous")?;
            conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")
                .context("set sqlite auto_vacuum")?;
        }
        let schema_tx = writer.unchecked_transaction()?;
        schema_tx.execute_batch(SCHEMA).context("create sqlite log tables")?;
        migrate_legacy_log_table(&schema_tx)?;
        reconcile_log_id_sequence(&schema_tx)?;
        if !column_exists(&schema_tx, "connections", "last_seen_at")? {
            schema_tx
                .execute("ALTER TABLE connections ADD COLUMN last_seen_at INTEGER", [])
                .context("add connections last_seen_at")?;
            schema_tx
                .execute(
                    "UPDATE connections
                     SET last_seen_at = COALESCE(closed_at, started_at)
                     WHERE last_seen_at IS NULL",
                    [],
                )
                .context("backfill connections last_seen_at")?;
        }
        if !column_exists(&schema_tx, "connections", "identity_checked_at")? {
            schema_tx
                .execute("ALTER TABLE connections ADD COLUMN identity_checked_at INTEGER", [])
                .context("add connections identity_checked_at")?;
        }
        schema_tx
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_connections_last_seen
                 ON connections(last_seen_at)",
                [],
            )
            .context("create connections last_seen index")?;
        if !had_traffic_daily_details {
            schema_tx
                .execute(
                    "INSERT INTO traffic_daily_details (
                       day, connection_id, process, host, ip, proxy, upload, download
                     )
                     SELECT date(started_at / 1000, 'unixepoch', 'localtime'),
                            connection_id, process, host, ip, proxy, upload, download
                     FROM connections",
                    [],
                )
                .context("backfill daily traffic details")?;
        }
        if !had_traffic_dimensions {
            schema_tx
                .execute_batch(
                    "DELETE FROM traffic_totals;
                     INSERT INTO traffic_totals (id, upload, download)
                     SELECT 1, COALESCE(SUM(upload), 0), COALESCE(SUM(download), 0)
                     FROM traffic_daily_details;

                     DELETE FROM traffic_daily;
                     INSERT INTO traffic_daily (day, upload, download)
                     SELECT day, SUM(upload), SUM(download)
                     FROM traffic_daily_details GROUP BY day;

                     DELETE FROM traffic_daily_dimensions;
                     INSERT INTO traffic_daily_dimensions (
                       day, process, host, ip, proxy, upload, download, connection_count
                     )
                     SELECT day, COALESCE(process, ''), COALESCE(host, ''),
                            COALESCE(ip, ''), COALESCE(proxy, ''),
                            SUM(upload), SUM(download), COUNT(DISTINCT connection_id)
                     FROM traffic_daily_details
                     GROUP BY day, process, host, ip, proxy;",
                )
                .context("backfill aggregated traffic tables")?;
        }
        schema_tx.commit().context("commit sqlite log schema migration")?;
        purge_non_persisted_levels(&writer).context("purge verbose sqlite logs")?;
        enforce_size_cap_on_conn(&writer, path, max_db_bytes).context("enforce sqlite log size cap")?;

        let cleared_at_value: i64 = writer
            .query_row(
                "SELECT cleared_at FROM log_clear_state WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let store = Arc::new(Self {
            writer: Mutex::new(writer),
            reader: Mutex::new(reader),
            queue: StdMutex::new(VecDeque::with_capacity(LOG_QUEUE_CAP)),
            notify: Notify::new(),
            retention_days: retention_days.max(1),
            max_db_bytes,
            db_path: path.to_path_buf(),
            service_snapshot_imported: AtomicBool::new(false),
            cleared_at: AtomicI64::new(cleared_at_value),
        });
        let worker_store = store.clone();
        tokio::spawn(async move {
            worker_store.run_worker().await;
        });
        Ok(store)
    }

    pub fn push(&self, entry: LogEntry) {
        if !should_persist_log_level(&entry.level) {
            return;
        }
        if entry.ts < self.cleared_at.load(Ordering::Acquire) {
            return;
        }
        let mut queue = self.queue.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if queue.len() >= LOG_QUEUE_CAP {
            queue.pop_front();
        }
        queue.push_back(entry);
        self.notify.notify_one();
    }

    pub fn cleared_at(&self) -> i64 {
        self.cleared_at.load(Ordering::Acquire)
    }

    fn drain_batch(&self, max: usize) -> Vec<LogEntry> {
        let mut queue = self.queue.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let take = queue.len().min(max);
        queue.drain(..take).collect()
    }

    async fn flush(&self, entries: Vec<LogEntry>) -> Result<()> {
        let entries: Vec<LogEntry> = entries
            .into_iter()
            .filter(|entry| should_persist_log_level(&entry.level))
            .collect();
        if entries.is_empty() {
            return Ok(());
        }
        let conn = self.writer.lock().await;
        let cutoff = self.cleared_at.load(Ordering::Acquire);
        let tx = conn.unchecked_transaction()?;
        let mut next_id = tx.query_row("SELECT next_id FROM log_id_sequence WHERE singleton = 1", [], |row| {
            row.get::<_, i64>(0)
        })?;
        for entry in &entries {
            if entry.ts < cutoff {
                continue;
            }
            let level = normalize_stored_log_level(&entry.level);
            let raw_hash = hash_raw(&entry.payload);
            let inserted = tx.execute(
                log_partition_insert_sql(&level),
                params![next_id, entry.ts, level, entry.source, entry.payload, "", raw_hash],
            )?;
            if inserted > 0 {
                next_id = next_id.saturating_add(1);
            }
        }
        tx.execute(
            "UPDATE log_id_sequence SET next_id = ?1 WHERE singleton = 1",
            params![next_id],
        )?;
        tx.commit()?;
        enforce_size_cap_on_conn(&conn, &self.db_path, self.max_db_bytes)?;
        Ok(())
    }

    #[cfg(test)]
    pub async fn enforce_size_cap(&self) -> Result<()> {
        let conn = self.writer.lock().await;
        enforce_size_cap_on_conn(&conn, &self.db_path, self.max_db_bytes)
    }

    async fn run_worker(&self) {
        let mut last_prune = SystemTime::now();
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            let _ = tokio::time::timeout(FLUSH_INTERVAL, notified.as_mut()).await;
            let batch = self.drain_batch(LOG_BATCH_MAX);
            if !batch.is_empty()
                && let Err(err) = self.flush(batch).await
            {
                log::warn!("[LogStore] flush failed: {err:#}");
            }
            if last_prune.elapsed().unwrap_or_default() >= RETENTION_PRUNE_INTERVAL {
                if let Err(err) = self.prune_expired().await {
                    log::warn!("[LogStore] prune failed: {err:#}");
                }
                last_prune = SystemTime::now();
            }
        }
    }

    pub async fn prune_expired(&self) -> Result<usize> {
        let log_cutoff = now_ms() - self.retention_days * 24 * 60 * 60 * 1000;
        let connection_cutoff = now_ms() - RAW_TRAFFIC_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        let detail_cutoff = (Local::now() - chrono::Duration::days(RAW_TRAFFIC_RETENTION_DAYS - 1))
            .format("%Y-%m-%d")
            .to_string();
        let conn = self.writer.lock().await;
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        for table in LOG_PARTITION_TABLES {
            count += tx.execute(&format!("DELETE FROM {table} WHERE ts < ?1"), params![log_cutoff])?;
        }
        count += tx.execute(
            "DELETE FROM connections WHERE last_seen_at < ?1",
            params![connection_cutoff],
        )?;
        count += tx.execute(
            "DELETE FROM traffic_daily_details WHERE day < ?1",
            params![detail_cutoff],
        )?;
        tx.commit()?;
        count += purge_non_persisted_levels(&conn)?;
        enforce_size_cap_on_conn(&conn, &self.db_path, self.max_db_bytes)?;
        Ok(count)
    }

    fn query_with_conn(conn: &Connection, query: &LogQuery) -> Result<Vec<LogEntry>> {
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        let mut sql = if let Some(level) = &query.level {
            let normalized = normalize_stored_log_level(level);
            let table = log_partition_table(&normalized);
            let mut statement = format!("SELECT id, ts, level, source, payload FROM {table} WHERE 1=1");
            if table == "logs_other" {
                statement.push_str(" AND level = ?");
                args.push(normalized.into());
            }
            statement
        } else {
            format!("SELECT id, ts, level, source, payload FROM ({LOG_UNION_SELECT}) AS partitioned_logs WHERE 1=1")
        };

        if let Some(from_ts) = query.from_ts {
            sql.push_str(" AND ts >= ?");
            args.push(from_ts.into());
        }
        if let Some(to_ts) = query.to_ts {
            sql.push_str(" AND ts <= ?");
            args.push(to_ts.into());
        }
        if let Some(source) = &query.source {
            sql.push_str(" AND source = ?");
            args.push(source.to_ascii_lowercase().into());
        }
        let descending = query.descending.unwrap_or(false);
        if let (Some(cursor_ts), Some(cursor_id)) = (query.cursor_ts, query.cursor_id) {
            if descending {
                sql.push_str(" AND (ts < ? OR (ts = ? AND id < ?))");
            } else {
                sql.push_str(" AND (ts > ? OR (ts = ? AND id > ?))");
            }
            args.push(cursor_ts.into());
            args.push(cursor_ts.into());
            args.push(cursor_id.into());
        }

        let limit = query.limit.unwrap_or(1000).clamp(1, MAX_QUERY_LIMIT);
        if descending {
            sql.push_str(" ORDER BY ts DESC, id DESC LIMIT ?");
        } else {
            sql.push_str(" ORDER BY ts ASC, id ASC LIMIT ?");
        }
        args.push(limit.into());

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(args.iter()), |row| {
            Ok(LogEntry {
                id: row.get(0)?,
                ts: row.get(1)?,
                level: row.get(2)?,
                source: row.get(3)?,
                payload: row.get(4)?,
            })
        })?;

        let mut out = Vec::with_capacity(limit as usize);
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    fn count_with_conn(conn: &Connection, query: &LogQuery) -> Result<i64> {
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        let mut sql = if let Some(level) = &query.level {
            let normalized = normalize_stored_log_level(level);
            let table = log_partition_table(&normalized);
            let mut statement = format!("SELECT COUNT(*) FROM {table} WHERE 1=1");
            if table == "logs_other" {
                statement.push_str(" AND level = ?");
                args.push(normalized.into());
            }
            statement
        } else {
            format!("SELECT COUNT(*) FROM ({LOG_UNION_SELECT}) AS partitioned_logs WHERE 1=1")
        };

        if let Some(from_ts) = query.from_ts {
            sql.push_str(" AND ts >= ?");
            args.push(from_ts.into());
        }
        if let Some(to_ts) = query.to_ts {
            sql.push_str(" AND ts <= ?");
            args.push(to_ts.into());
        }
        if let Some(source) = &query.source {
            sql.push_str(" AND source = ?");
            args.push(source.to_ascii_lowercase().into());
        }

        Ok(conn.query_row(&sql, params_from_iter(args.iter()), |row| row.get::<_, i64>(0))?)
    }

    #[cfg(test)]
    pub async fn query(&self, query: &LogQuery) -> Result<Vec<LogEntry>> {
        let conn = self.reader.lock().await;
        Self::query_with_conn(&conn, query)
    }

    pub async fn query_page(&self, query: &LogQuery) -> Result<LogPage> {
        let conn = self.reader.lock().await;
        let tx = conn.unchecked_transaction()?;
        let total = Self::count_with_conn(&tx, query)?;
        let entries = Self::query_with_conn(&tx, query)?;
        tx.commit()?;
        Ok(LogPage { entries, total })
    }

    pub async fn contains_log_entry(&self, entry: &LogEntry) -> Result<bool> {
        let level = normalize_stored_log_level(&entry.level);
        let table = log_partition_table(&level);
        let sql = format!("SELECT 1 FROM {table} WHERE source = ?1 AND ts = ?2 AND raw_hash = ?3 LIMIT 1");
        let raw_hash = hash_raw(&entry.payload);
        let conn = self.reader.lock().await;
        Ok(conn
            .query_row(&sql, params![entry.source, entry.ts, raw_hash], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn claim_service_snapshot_import(&self) -> bool {
        !self.service_snapshot_imported.swap(true, Ordering::AcqRel)
    }

    pub fn retry_service_snapshot_import(&self) {
        self.service_snapshot_imported.store(false, Ordering::Release);
    }

    pub async fn ingest_log_text(&self, content: &str, source: &str) -> Result<usize> {
        let mut count = 0usize;
        let mut batch = Vec::with_capacity(LOG_BATCH_MAX);
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            batch.push(parse_sidecar_line(line, source));
            if batch.len() >= LOG_BATCH_MAX {
                let persistable: Vec<LogEntry> = batch
                    .into_iter()
                    .filter(|entry| should_persist_log_level(&entry.level))
                    .collect();
                count += persistable.len();
                self.flush(persistable).await?;
                batch = Vec::with_capacity(LOG_BATCH_MAX);
            }
        }
        if !batch.is_empty() {
            let persistable: Vec<LogEntry> = batch
                .into_iter()
                .filter(|entry| should_persist_log_level(&entry.level))
                .collect();
            count += persistable.len();
            self.flush(persistable).await?;
        }
        Ok(count)
    }

    pub async fn ingest_log_entries(&self, entries: Vec<LogEntry>) -> Result<usize> {
        let persistable: Vec<LogEntry> = entries
            .into_iter()
            .filter(|entry| should_persist_log_level(&entry.level))
            .collect();
        let count = persistable.len();
        self.flush(persistable).await?;
        Ok(count)
    }

    pub async fn append_entries(&self, entries: Vec<LogEntry>) -> Result<usize> {
        let cutoff = self.cleared_at.load(Ordering::Acquire);
        let kept: Vec<_> = entries.into_iter().filter(|entry| entry.ts >= cutoff).collect();
        let count = kept.len();
        self.flush(kept).await?;
        Ok(count)
    }

    pub async fn backfill_sidecar_files(&self) -> Result<usize> {
        let dir = dirs::sidecar_log_dir()?;
        if !tokio::fs::try_exists(&dir).await? {
            return Ok(0);
        }
        let cutoff = SystemTime::now()
            .checked_sub(Duration::from_secs(self.retention_days as u64 * 24 * 60 * 60))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let mut read_dir = tokio::fs::read_dir(&dir).await?;
        let mut paths = Vec::new();

        while let Some(entry) = read_dir.next_entry().await? {
            let path = entry.path();
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
            if !name.starts_with("sidecar_") || !name.ends_with(".log") {
                continue;
            }
            let metadata = entry.metadata().await?;
            let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            if modified >= cutoff {
                let modified_ms = modified.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
                paths.push((path, modified_ms, metadata.len() as i64));
            }
        }

        paths.sort();

        let mut count = 0usize;
        for (path, modified_ms, size) in paths {
            let path_key = path.to_string_lossy().to_string();
            let unchanged = {
                let conn = self.reader.lock().await;
                conn.query_row(
                    "SELECT modified_ms, size FROM log_backfill_checkpoints WHERE path = ?1",
                    params![path_key],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()?
                    == Some((modified_ms, size))
            };
            if unchanged {
                continue;
            }
            let Ok(content) = tokio::fs::read_to_string(&path).await else {
                continue;
            };
            let mut batch = Vec::with_capacity(LOG_BATCH_MAX);
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                batch.push(parse_sidecar_line(line, "core"));
                if batch.len() >= LOG_BATCH_MAX {
                    let persistable: Vec<LogEntry> = batch
                        .into_iter()
                        .filter(|entry| should_persist_log_level(&entry.level))
                        .collect();
                    count += persistable.len();
                    self.flush(persistable).await?;
                    batch = Vec::with_capacity(LOG_BATCH_MAX);
                }
            }
            if !batch.is_empty() {
                let persistable: Vec<LogEntry> = batch
                    .into_iter()
                    .filter(|entry| should_persist_log_level(&entry.level))
                    .collect();
                count += persistable.len();
                self.flush(persistable).await?;
            }
            let conn = self.writer.lock().await;
            conn.execute(
                "INSERT INTO log_backfill_checkpoints (path, modified_ms, size)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(path) DO UPDATE SET
                   modified_ms = excluded.modified_ms,
                   size = excluded.size",
                params![path_key, modified_ms, size],
            )?;
        }

        Ok(count)
    }

    pub async fn upsert_connections(&self, entries: Vec<ConnectionEntry>) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }
        let conn = self.writer.lock().await;
        let tx = conn.unchecked_transaction()?;
        let fallback_observed_at = now_ms();
        {
            let mut previous_stmt =
                tx.prepare_cached("SELECT upload, download FROM connections WHERE connection_id = ?1")?;
            let mut previous_detail_stmt = tx.prepare_cached(
                "SELECT COALESCE(process, ''), COALESCE(host, ''),
                        COALESCE(ip, ''), COALESCE(proxy, ''), upload, download
                 FROM traffic_daily_details
                 WHERE day = ?1 AND connection_id = ?2",
            )?;
            let mut stmt = tx.prepare_cached(
                "INSERT INTO connections (
                   connection_id, started_at, closed_at, process, host, ip, port,
                   source_port, destination_port, rule, proxy, upload, download, confidence,
                   last_seen_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                 ON CONFLICT(connection_id) DO UPDATE SET
                   closed_at = COALESCE(excluded.closed_at, connections.closed_at),
                   process = COALESCE(excluded.process, connections.process),
                   host = COALESCE(excluded.host, connections.host),
                   ip = COALESCE(excluded.ip, connections.ip),
                   port = COALESCE(excluded.port, connections.port),
                   source_port = COALESCE(excluded.source_port, connections.source_port),
                   destination_port = COALESCE(excluded.destination_port, connections.destination_port),
                   rule = COALESCE(excluded.rule, connections.rule),
                   proxy = COALESCE(excluded.proxy, connections.proxy),
                   upload = MAX(connections.upload, excluded.upload),
                   download = MAX(connections.download, excluded.download),
                   confidence = excluded.confidence,
                   last_seen_at = excluded.last_seen_at
                 WHERE excluded.closed_at IS NOT connections.closed_at
                    OR excluded.process IS NOT connections.process
                    OR excluded.host IS NOT connections.host
                    OR excluded.ip IS NOT connections.ip
                    OR excluded.port IS NOT connections.port
                    OR excluded.source_port IS NOT connections.source_port
                    OR excluded.destination_port IS NOT connections.destination_port
                    OR excluded.rule IS NOT connections.rule
                    OR excluded.proxy IS NOT connections.proxy
                    OR excluded.upload IS NOT connections.upload
                    OR excluded.download IS NOT connections.download
                    OR excluded.confidence IS NOT connections.confidence
                    OR excluded.last_seen_at IS NOT connections.last_seen_at",
            )?;
            let mut daily_stmt = tx.prepare_cached(
                "INSERT INTO traffic_daily_details (
                   day, connection_id, process, host, ip, proxy, upload, download
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(day, connection_id) DO UPDATE SET
                   process = COALESCE(excluded.process, traffic_daily_details.process),
                   host = COALESCE(excluded.host, traffic_daily_details.host),
                   ip = COALESCE(excluded.ip, traffic_daily_details.ip),
                   proxy = COALESCE(excluded.proxy, traffic_daily_details.proxy),
                   upload = traffic_daily_details.upload + excluded.upload,
                   download = traffic_daily_details.download + excluded.download",
            )?;
            let mut total_stmt = tx.prepare_cached(
                "UPDATE traffic_totals
                 SET upload = upload + ?1, download = download + ?2
                 WHERE id = 1",
            )?;
            let mut day_stmt = tx.prepare_cached(
                "INSERT INTO traffic_daily (day, upload, download)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(day) DO UPDATE SET
                   upload = traffic_daily.upload + excluded.upload,
                   download = traffic_daily.download + excluded.download",
            )?;
            let mut dimension_stmt = tx.prepare_cached(
                "INSERT INTO traffic_daily_dimensions (
                   day, process, host, ip, proxy, upload, download, connection_count
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(day, process, host, ip, proxy) DO UPDATE SET
                   upload = traffic_daily_dimensions.upload + excluded.upload,
                   download = traffic_daily_dimensions.download + excluded.download,
                   connection_count = traffic_daily_dimensions.connection_count + excluded.connection_count",
            )?;
            let mut subtract_dimension_stmt = tx.prepare_cached(
                "UPDATE traffic_daily_dimensions SET
                   upload = MAX(0, upload - ?1),
                   download = MAX(0, download - ?2),
                   connection_count = MAX(0, connection_count - 1)
                 WHERE day = ?3 AND process = ?4 AND host = ?5 AND ip = ?6 AND proxy = ?7",
            )?;
            let mut delete_empty_dimension_stmt = tx.prepare_cached(
                "DELETE FROM traffic_daily_dimensions
                 WHERE day = ?1 AND process = ?2 AND host = ?3 AND ip = ?4 AND proxy = ?5
                   AND upload = 0 AND download = 0 AND connection_count = 0",
            )?;
            for entry in &entries {
                let observed_at = entry.observed_at.unwrap_or(fallback_observed_at);
                let day = local_day(observed_at);
                let previous: Option<(i64, i64)> = previous_stmt
                    .query_row(params![entry.connection_id], |row| Ok((row.get(0)?, row.get(1)?)))
                    .optional()?;
                let upload_delta = previous
                    .map(|(upload, _)| entry.upload.saturating_sub(upload).max(0))
                    .unwrap_or_else(|| entry.upload.max(0));
                let download_delta = previous
                    .map(|(_, download)| entry.download.saturating_sub(download).max(0))
                    .unwrap_or_else(|| entry.download.max(0));
                let previous_detail: Option<(String, String, String, String, i64, i64)> = previous_detail_stmt
                    .query_row(params![day, entry.connection_id], |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        ))
                    })
                    .optional()?;
                let process = entry
                    .process
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| previous_detail.as_ref().map(|value| value.0.as_str()).unwrap_or(""));
                let host = entry
                    .host
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| previous_detail.as_ref().map(|value| value.1.as_str()).unwrap_or(""));
                let ip = entry
                    .ip
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| previous_detail.as_ref().map(|value| value.2.as_str()).unwrap_or(""));
                let proxy = entry
                    .proxy
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| previous_detail.as_ref().map(|value| value.3.as_str()).unwrap_or(""));
                stmt.execute(params![
                    entry.connection_id,
                    entry.started_at,
                    entry.closed_at,
                    entry.process,
                    entry.host,
                    entry.ip,
                    entry.port,
                    entry.source_port,
                    entry.destination_port,
                    entry.rule,
                    entry.proxy,
                    entry.upload,
                    entry.download,
                    entry.confidence,
                    observed_at,
                ])?;

                if upload_delta > 0 || download_delta > 0 {
                    total_stmt.execute(params![upload_delta, download_delta])?;
                    day_stmt.execute(params![day, upload_delta, download_delta])?;
                }

                let identity_changed = previous_detail
                    .as_ref()
                    .is_some_and(|value| value.0 != process || value.1 != host || value.2 != ip || value.3 != proxy);
                let is_new_detail = previous_detail.is_none();
                if identity_changed {
                    let previous_detail = previous_detail.as_ref().expect("checked above");
                    subtract_dimension_stmt.execute(params![
                        previous_detail.4,
                        previous_detail.5,
                        day,
                        previous_detail.0,
                        previous_detail.1,
                        previous_detail.2,
                        previous_detail.3
                    ])?;
                    delete_empty_dimension_stmt.execute(params![
                        day,
                        previous_detail.0,
                        previous_detail.1,
                        previous_detail.2,
                        previous_detail.3
                    ])?;
                }

                if upload_delta > 0 || download_delta > 0 || identity_changed || is_new_detail {
                    daily_stmt.execute(params![
                        day,
                        entry.connection_id,
                        process,
                        host,
                        ip,
                        proxy,
                        upload_delta,
                        download_delta
                    ])?;
                    let (dimension_upload, dimension_download, connection_count) = if identity_changed {
                        let previous_detail = previous_detail.as_ref().expect("checked above");
                        (previous_detail.4 + upload_delta, previous_detail.5 + download_delta, 1)
                    } else {
                        (upload_delta, download_delta, i64::from(previous_detail.is_none()))
                    };
                    dimension_stmt.execute(params![
                        day,
                        process,
                        host,
                        ip,
                        proxy,
                        dimension_upload,
                        dimension_download,
                        connection_count
                    ])?;
                }
            }
        }
        tx.commit()?;
        Ok(entries.len())
    }

    pub async fn traffic_totals(&self) -> Result<TrafficTotals> {
        let day = Local::now().format("%Y-%m-%d").to_string();
        let conn = self.reader.lock().await;
        let tx = conn.unchecked_transaction()?;
        let (total_upload, total_download) =
            tx.query_row("SELECT upload, download FROM traffic_totals WHERE id = 1", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })?;
        let (today_upload, today_download) = tx
            .query_row(
                "SELECT upload, download FROM traffic_daily WHERE day = ?1",
                params![day],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .unwrap_or_default();
        tx.commit()?;
        Ok(TrafficTotals {
            today_upload,
            today_download,
            total_upload,
            total_download,
        })
    }

    pub async fn clear_traffic_history(&self) -> Result<usize> {
        let conn = self.writer.lock().await;
        let tx = conn.unchecked_transaction()?;
        let mut count = tx.execute("DELETE FROM traffic_daily_details", [])?;
        count += tx.execute("DELETE FROM traffic_daily_dimensions", [])?;
        count += tx.execute("DELETE FROM traffic_daily", [])?;
        tx.execute("UPDATE traffic_totals SET upload = 0, download = 0 WHERE id = 1", [])?;
        tx.commit()?;
        conn.execute_batch("PRAGMA incremental_vacuum(256)")?;
        Ok(count)
    }

    pub async fn clear_logs(&self) -> Result<usize> {
        let now = now_ms();
        let conn = self.writer.lock().await;
        let tx = conn.unchecked_transaction()?;
        let mut count = 0usize;
        for table in LOG_PARTITION_TABLES {
            count += tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        tx.execute(
            "INSERT INTO log_clear_state (singleton, cleared_at) VALUES (1, ?1)
             ON CONFLICT(singleton) DO UPDATE SET cleared_at = excluded.cleared_at",
            params![now],
        )?;
        tx.commit()?;
        self.cleared_at.store(now, Ordering::Release);
        {
            let mut queue = self.queue.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            queue.retain(|entry| entry.ts >= now);
        }
        conn.execute_batch("PRAGMA incremental_vacuum(256)")?;
        Ok(count)
    }

    pub async fn traffic_rank(&self, from_ts: Option<i64>, to_ts: Option<i64>) -> Result<Vec<TrafficBucket>> {
        let mut sql = String::from(
            "SELECT MIN(day),
                    COALESCE(process, ''), COALESCE(host, ''), COALESCE(ip, ''),
                    proxy, SUM(upload), SUM(download),
                    SUM(connection_count)
             FROM traffic_daily_dimensions WHERE 1=1",
        );
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(from_ts) = from_ts {
            sql.push_str(" AND day >= date(? / 1000, 'unixepoch', 'localtime')");
            args.push(from_ts.into());
        }
        if let Some(to_ts) = to_ts {
            sql.push_str(" AND day <= date(? / 1000, 'unixepoch', 'localtime')");
            args.push(to_ts.into());
        }
        sql.push_str(
            " GROUP BY process, host, ip, proxy
              ORDER BY download DESC, upload DESC",
        );

        let conn = self.reader.lock().await;
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(args.iter()), |row| {
            Ok(TrafficBucket {
                date: row.get(0)?,
                process: row.get(1)?,
                host: row.get(2)?,
                ip: row.get(3)?,
                proxy: row.get(4)?,
                upload: row.get(5)?,
                download: row.get(6)?,
                connection_count: row.get(7)?,
            })
        })?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub async fn associate_connections_from_logs(&self) -> Result<usize> {
        let checked_before = now_ms() - 24 * 60 * 60 * 1000;
        let (candidates, log_matches) = {
            let conn = self.reader.lock().await;
            let mut stmt = conn.prepare(
                "SELECT connection_id, source_port, destination_port, started_at
                 FROM connections
                 WHERE (NULLIF(process, '') IS NULL OR NULLIF(host, '') IS NULL)
                   AND source_port IS NOT NULL
                   AND destination_port IS NOT NULL
                   AND (identity_checked_at IS NULL OR identity_checked_at < ?1)
                 LIMIT 5000",
            )?;
            let rows = stmt.query_map(params![checked_before], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?;
            let mut out: Vec<(String, i64, i64, i64)> = Vec::new();
            for row in rows {
                out.push(row?);
            }
            drop(stmt);

            if out.is_empty() {
                return Ok(0);
            }

            let relevant_ports: HashSet<(i64, i64)> = out
                .iter()
                .map(|(_, source_port, destination_port, _)| (*source_port, *destination_port))
                .collect();
            let min_ts = out.iter().map(|entry| entry.3).min().unwrap_or_default() - 60_000;
            let max_ts = out.iter().map(|entry| entry.3).max().unwrap_or_default() + 60_000;
            let log_sql = format!(
                "SELECT ts, payload FROM ({LOG_UNION_SELECT}) AS partitioned_logs
                 WHERE source = 'core' AND ts BETWEEN ?1 AND ?2
                   AND instr(payload, ' --> ') > 0
                 ORDER BY ts DESC"
            );
            let mut log_stmt = conn.prepare(&log_sql)?;
            let logs = log_stmt.query_map(params![min_ts, max_ts], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut matches: HashMap<(i64, i64), Vec<(i64, String, String)>> = HashMap::new();
            for log in logs {
                let (ts, payload) = log?;
                let Some((source_port, process, host, destination_port)) = parse_log_route(&payload) else {
                    continue;
                };
                let ports = (source_port, destination_port);
                if relevant_ports.contains(&ports) {
                    matches.entry(ports).or_default().push((ts, process, host));
                }
            }
            (out, matches)
        };

        let checked_at = now_ms();
        let conn = self.writer.lock().await;
        let tx = conn.unchecked_transaction()?;
        let mut mark_checked_stmt =
            tx.prepare_cached("UPDATE connections SET identity_checked_at = ?1 WHERE connection_id = ?2")?;
        let mut update_connection_stmt = tx.prepare_cached(
            "UPDATE connections SET
               process = COALESCE(NULLIF(process, ''), ?1),
               host = COALESCE(NULLIF(host, ''), ?2),
               ip = COALESCE(NULLIF(ip, ''), ?3),
               confidence = 'medium',
               identity_checked_at = ?4
             WHERE connection_id = ?5",
        )?;
        let mut update_detail_stmt = tx.prepare_cached(
            "UPDATE traffic_daily_details SET
               process = COALESCE(NULLIF(process, ''), ?1),
               host = COALESCE(NULLIF(host, ''), ?2),
               ip = COALESCE(NULLIF(ip, ''), ?3)
             WHERE connection_id = ?4",
        )?;
        let mut detail_stmt = tx.prepare_cached(
            "SELECT day, COALESCE(process, ''), COALESCE(host, ''),
                    COALESCE(ip, ''), COALESCE(proxy, ''), upload, download
             FROM traffic_daily_details WHERE connection_id = ?1",
        )?;
        let mut subtract_dimension_stmt = tx.prepare_cached(
            "UPDATE traffic_daily_dimensions SET
               upload = MAX(0, upload - ?1),
               download = MAX(0, download - ?2),
               connection_count = MAX(0, connection_count - 1)
             WHERE day = ?3 AND process = ?4 AND host = ?5 AND ip = ?6 AND proxy = ?7",
        )?;
        let mut delete_empty_dimension_stmt = tx.prepare_cached(
            "DELETE FROM traffic_daily_dimensions
             WHERE day = ?1 AND process = ?2 AND host = ?3 AND ip = ?4 AND proxy = ?5
               AND upload = 0 AND download = 0 AND connection_count = 0",
        )?;
        let mut add_dimension_stmt = tx.prepare_cached(
            "INSERT INTO traffic_daily_dimensions (
               day, process, host, ip, proxy, upload, download, connection_count
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
             ON CONFLICT(day, process, host, ip, proxy) DO UPDATE SET
               upload = traffic_daily_dimensions.upload + excluded.upload,
               download = traffic_daily_dimensions.download + excluded.download,
               connection_count = traffic_daily_dimensions.connection_count + 1",
        )?;
        let mut updated = 0;
        for (id, source_port, destination_port, started_at) in candidates {
            let identity = log_matches.get(&(source_port, destination_port)).and_then(|entries| {
                entries
                    .iter()
                    .find(|(ts, _, _)| *ts >= started_at - 60_000 && *ts <= started_at + 60_000)
            });
            let Some((_, process, host)) = identity else {
                mark_checked_stmt.execute(params![checked_at, id])?;
                continue;
            };
            let ip = if host.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ':') {
                Some(host.clone())
            } else {
                None
            };
            let details = detail_stmt
                .query_map(params![id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for (day, old_process, old_host, old_ip, proxy, upload, download) in details {
                let next_process = if old_process.is_empty() { process } else { &old_process };
                let next_host = if old_host.is_empty() { host } else { &old_host };
                let next_ip = if old_ip.is_empty() {
                    ip.as_deref().unwrap_or("")
                } else {
                    &old_ip
                };
                if old_process == *next_process && old_host == *next_host && old_ip == next_ip {
                    continue;
                }
                subtract_dimension_stmt.execute(params![
                    upload,
                    download,
                    day,
                    old_process,
                    old_host,
                    old_ip,
                    proxy
                ])?;
                delete_empty_dimension_stmt.execute(params![day, old_process, old_host, old_ip, proxy])?;
                add_dimension_stmt.execute(params![day, next_process, next_host, next_ip, proxy, upload, download])?;
            }
            update_connection_stmt.execute(params![process, host, ip, checked_at, id])?;
            update_detail_stmt.execute(params![process, host, ip, id])?;
            updated += 1;
        }
        drop(mark_checked_stmt);
        drop(update_connection_stmt);
        drop(update_detail_stmt);
        drop(detail_stmt);
        drop(subtract_dimension_stmt);
        drop(delete_empty_dimension_stmt);
        drop(add_dimension_stmt);
        tx.commit()?;
        Ok(updated)
    }
}

pub fn init_global() -> Result<()> {
    if LOG_STORE.get().is_some() {
        return Ok(());
    }
    let _init_guard = LOG_STORE_INIT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if LOG_STORE.get().is_some() {
        return Ok(());
    }
    let path = dirs::app_logs_dir()?.join("logs.db");
    let store = SqliteLogStore::open(&path, DEFAULT_RETENTION_DAYS)?;
    let _ = LOG_STORE.set(store.clone());
    tokio::spawn(async move {
        if let Err(err) = store.backfill_sidecar_files().await {
            log::warn!("[LogStore] sidecar backfill failed: {err:#}");
        }
        if let Err(err) = store.associate_connections_from_logs().await {
            log::warn!("[LogStore] connection log association failed: {err:#}");
        }
    });
    Ok(())
}

pub fn get() -> Option<&'static Arc<SqliteLogStore>> {
    LOG_STORE.get()
}

fn normalize_stored_log_level(level: &str) -> String {
    match level.trim().to_ascii_lowercase().as_str() {
        "warn" | "warning" => "warning".to_string(),
        "err" | "error" => "error".to_string(),
        "inf" | "info" => "info".to_string(),
        value => value.to_string(),
    }
}

pub fn parse_sidecar_line(line: &str, source: &str) -> LogEntry {
    static MIHOMO_RE: OnceCell<Regex> = OnceCell::new();
    let mihomo_re = MIHOMO_RE
        .get_or_init(|| Regex::new(r#"time="([^"]*)"\s+level=(\w+)\s+msg="(.*)"$"#).expect("valid sidecar log regex"));
    if let Some(caps) = mihomo_re.captures(line) {
        let ts = DateTime::parse_from_rfc3339(&caps[1])
            .map(|dt| dt.timestamp_millis())
            .unwrap_or_else(|_| now_ms());
        return LogEntry::new(ts, normalize_stored_log_level(&caps[2]), source, caps[3].to_string());
    }

    static PREFIX_RE: OnceCell<Regex> = OnceCell::new();
    let prefix_re = PREFIX_RE.get_or_init(|| Regex::new(r"^\[([^]]+)]\s*(.*)$").expect("valid prefixed log regex"));
    if let Some(caps) = prefix_re.captures(line) {
        let parsed = NaiveDateTime::parse_from_str(&caps[1], "%Y-%m-%d %H:%M:%S%.3f")
            .or_else(|_| NaiveDateTime::parse_from_str(&caps[1], "%Y-%m-%d %H:%M:%S"));
        if let Ok(local) = parsed
            && let Some(ts) = Local.from_local_datetime(&local).single()
        {
            return LogEntry::new(ts.timestamp_millis(), "unknown", source, caps[2].to_string());
        }
    }

    LogEntry::new(0, "unknown", source, line.to_string())
}

fn parse_log_route(payload: &str) -> Option<(i64, String, String, i64)> {
    static RE: OnceCell<Regex> = OnceCell::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"([0-9.]+):(\d+)\(([^)]+)\)\s+-->\s+([^\s:]+):(\d+)").expect("valid log identity regex")
    });
    let caps = re.captures(payload)?;
    Some((
        caps[2].parse().ok()?,
        caps[3].to_string(),
        caps[4].to_string(),
        caps[5].parse().ok()?,
    ))
}

#[cfg(test)]
fn parse_log_identity(payload: &str, destination_port: i64) -> Option<(String, String)> {
    let (_, process, host, parsed_destination_port) = parse_log_route(payload)?;
    if parsed_destination_port != destination_port {
        return None;
    }
    Some((process, host))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_db() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs.db");
        (dir, path)
    }

    #[test]
    fn persists_only_warning_error_and_fatal_levels() {
        assert!(should_persist_log_level("warning"));
        assert!(should_persist_log_level("warn"));
        assert!(should_persist_log_level("error"));
        assert!(should_persist_log_level("err"));
        assert!(should_persist_log_level("fatal"));
        assert!(should_persist_log_level("critical"));
        assert!(!should_persist_log_level("info"));
        assert!(!should_persist_log_level("debug"));
        assert!(!should_persist_log_level("unknown"));
    }

    #[tokio::test]
    async fn drops_verbose_levels_and_caps_database_file() {
        let (_dir, path) = temp_db();
        let cap = 2 * 1024 * 1024;
        let store = SqliteLogStore::open_with_limits(&path, 7, cap).unwrap();
        let bulky = "x".repeat(32 * 1024);
        let entries = (0..100)
            .map(|i| LogEntry::new(1_000 + i, "warning", "core", format!("{i}-{bulky}")))
            .collect::<Vec<_>>();
        store.ingest_log_entries(entries).await.unwrap();
        store.enforce_size_cap().await.unwrap();

        let remaining = store
            .query(&LogQuery {
                from_ts: Some(0),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(!remaining.is_empty());
        assert!(remaining.len() < 100);
        let db_bytes = sqlite_sidecar_bytes(&path);
        assert!(db_bytes <= cap + 128 * 1024, "db grew to {db_bytes} bytes");
    }

    #[tokio::test]
    async fn insert_query_prune_roundtrip() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store.push(LogEntry::new(1000, "warning", "core", "boom"));
        store.push(LogEntry::new(2000, "info", "core", "ok"));

        // Worker flushes asynchronously; wait briefly.
        tokio::time::sleep(Duration::from_millis(250)).await;

        let logs = store
            .query(&LogQuery {
                from_ts: Some(0),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].level, "warning");
        assert_eq!(logs[0].payload, "boom");

        store.prune_expired().await.unwrap();
        let logs = store
            .query(&LogQuery {
                from_ts: Some(0),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(logs.is_empty());
    }

    #[tokio::test]
    async fn clear_logs_deletes_rows_and_blocks_old_reingest() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store
            .ingest_log_entries(vec![
                LogEntry::new(1000, "warning", "core", "old warn"),
                LogEntry::new(2000, "error", "core", "old err"),
                LogEntry::new(3000, "info", "core", "old info"),
            ])
            .await
            .unwrap();
        assert_eq!(
            store
                .query(&LogQuery {
                    from_ts: Some(0),
                    ..Default::default()
                })
                .await
                .unwrap()
                .len(),
            3
        );

        let deleted = store.clear_logs().await.unwrap();
        assert_eq!(deleted, 3);
        assert!(store.cleared_at() > 0);
        assert!(
            store
                .query(&LogQuery {
                    from_ts: Some(0),
                    ..Default::default()
                })
                .await
                .unwrap()
                .is_empty()
        );

        store
            .append_entries(vec![
                LogEntry::new(1000, "warning", "core", "old warn"),
                LogEntry::new(store.cleared_at() - 1, "error", "core", "just before clear"),
                LogEntry::new(store.cleared_at(), "warning", "core", "new warn"),
            ])
            .await
            .unwrap();
        let logs = store
            .query(&LogQuery {
                from_ts: Some(0),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].payload, "new warn");

        store.push(LogEntry::new(1, "warning", "core", "too old to queue"));
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert_eq!(
            store
                .query(&LogQuery {
                    from_ts: Some(0),
                    ..Default::default()
                })
                .await
                .unwrap()
                .len(),
            1
        );

        let cutoff = store.cleared_at();
        drop(store);
        let reopened = SqliteLogStore::open(&path, 7).unwrap();
        assert_eq!(reopened.cleared_at(), cutoff);

        reopened
            .ingest_log_text("garbage line that has no timestamp\n", "core")
            .await
            .unwrap();
        let after_garbage = reopened
            .query(&LogQuery {
                from_ts: Some(0),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(after_garbage.len(), 1);
        assert_eq!(after_garbage[0].payload, "new warn");
    }

    #[tokio::test]
    async fn dedupes_identical_payloads() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store.push(LogEntry::new(1000, "warning", "core", "same"));
        store.push(LogEntry::new(1000, "warning", "core", "same"));
        tokio::time::sleep(Duration::from_millis(250)).await;

        let logs = store
            .query(&LogQuery {
                from_ts: Some(0),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(logs.len(), 1);
    }

    #[tokio::test]
    async fn queries_descending_log_pages_by_level() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store.push(LogEntry::new(1000, "warning", "core", "old"));
        store.push(LogEntry::new(2000, "info", "core", "ignored"));
        store.push(LogEntry::new(3000, "warning", "core", "new"));
        tokio::time::sleep(Duration::from_millis(250)).await;

        let first = store
            .query(&LogQuery {
                level: Some("warning".into()),
                limit: Some(1),
                descending: Some(true),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].payload, "new");

        let second = store
            .query(&LogQuery {
                level: Some("warning".into()),
                limit: Some(1),
                cursor_ts: Some(first[0].ts),
                cursor_id: Some(first[0].id),
                descending: Some(true),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].payload, "old");
    }

    #[tokio::test]
    async fn routes_logs_into_physical_level_tables() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store
            .ingest_log_entries(vec![
                LogEntry::new(1000, "debug", "core", "debug line"),
                LogEntry::new(2000, "info", "core", "info line"),
                LogEntry::new(3000, "warn", "core", "warning line"),
                LogEntry::new(4000, "err", "core", "error line"),
                LogEntry::new(5000, "unknown", "core", "other line"),
            ])
            .await
            .unwrap();

        let conn = store.reader.lock().await;
        let counts = LOG_PARTITION_TABLES.map(|table| {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get::<_, i64>(0))
                .unwrap()
        });
        assert_eq!(counts, [0, 0, 1, 1, 0]);
    }

    #[tokio::test]
    async fn migrates_legacy_logs_into_level_tables() {
        let (_dir, path) = temp_db();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE logs (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               ts INTEGER NOT NULL,
               level TEXT NOT NULL,
               source TEXT NOT NULL,
               payload TEXT NOT NULL,
               raw TEXT NOT NULL,
               raw_hash TEXT NOT NULL
             );
             INSERT INTO logs (ts, level, source, payload, raw, raw_hash)
             VALUES (1000, 'warn', 'core', 'legacy warning', '', 'a'),
                    (2000, 'error', 'core', 'legacy error', '', 'b');",
        )
        .unwrap();
        drop(conn);

        let store = SqliteLogStore::open(&path, 7).unwrap();
        let warning = store
            .query(&LogQuery {
                level: Some("warning".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        let error = store
            .query(&LogQuery {
                level: Some("error".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(warning[0].payload, "legacy warning");
        assert_eq!(error[0].payload, "legacy error");

        let conn = store.reader.lock().await;
        assert!(!table_exists(&conn, "logs").unwrap());
        assert!(table_exists(&conn, "logs_warning").unwrap());
        assert!(table_exists(&conn, "logs_error").unwrap());
    }

    #[tokio::test]
    async fn paginates_ingested_service_logs_and_matches_level_aliases() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        let entries = (1..=1002)
            .map(|ts| {
                let level = if ts == 1002 { "error" } else { "warning" };
                LogEntry::new(ts, level, "core", format!("line {ts}"))
            })
            .collect();
        store.ingest_log_entries(entries).await.unwrap();

        let error = store
            .query_page(&LogQuery {
                level: Some("error".into()),
                descending: Some(true),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(error.total, 1);
        assert_eq!(error.entries.len(), 1);
        assert_eq!(error.entries[0].payload, "line 1002");

        let first = store
            .query_page(&LogQuery {
                limit: Some(1001),
                descending: Some(true),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(first.total, 1002);
        assert_eq!(first.entries.len(), 1001);
        let page_cursor = &first.entries[999];
        let second = store
            .query_page(&LogQuery {
                limit: Some(1001),
                cursor_ts: Some(page_cursor.ts),
                cursor_id: Some(page_cursor.id),
                descending: Some(true),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(second.total, 1002);
        assert_eq!(second.entries.len(), 2);
    }

    #[tokio::test]
    async fn detects_existing_service_log_overlap() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        let existing = LogEntry::new(1_700_000_000_000, "warning", "core", "existing line");
        store.ingest_log_entries(vec![existing.clone()]).await.unwrap();

        assert!(store.contains_log_entry(&existing).await.unwrap());
        assert!(
            !store
                .contains_log_entry(&LogEntry::new(existing.ts, "warning", "core", "different line",))
                .await
                .unwrap()
        );
    }

    #[test]
    fn parses_sidecar_line() {
        let line = r#"[2026-08-03 00:00:00.000] time="2026-08-03T00:00:00+08:00" level=warn msg="[TCP] dial failed""#;
        let entry = parse_sidecar_line(line, "core");
        assert_eq!(entry.level, "warning");
        assert!(entry.payload.starts_with("[TCP]"));
    }

    #[test]
    fn parses_prefixed_non_mihomo_line_with_stable_timestamp() {
        let line = "[2026-08-03 06:10:53.155] Process terminated with code: 0";
        let first = parse_sidecar_line(line, "core");
        let second = parse_sidecar_line(line, "core");
        assert_eq!(first.ts, second.ts);
        assert_eq!(first.level, "unknown");
        assert_eq!(first.payload, "Process terminated with code: 0");
    }

    #[tokio::test]
    async fn traffic_rank_aggregates_by_host() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store
            .upsert_connections(vec![
                ConnectionEntry {
                    connection_id: "a".into(),
                    started_at: 1_000_000_000_000,
                    observed_at: None,
                    closed_at: None,
                    process: Some("firefox.exe".into()),
                    host: Some("api.example.com".into()),
                    ip: Some("1.2.3.4".into()),
                    port: Some(443),
                    source_port: Some(50_000),
                    destination_port: Some(443),
                    rule: None,
                    proxy: Some("JMS".into()),
                    upload: 100,
                    download: 200,
                    confidence: "high".into(),
                },
                ConnectionEntry {
                    connection_id: "b".into(),
                    started_at: 1_000_000_000_000,
                    observed_at: None,
                    closed_at: None,
                    process: Some("firefox.exe".into()),
                    host: Some("api.example.com".into()),
                    ip: Some("1.2.3.4".into()),
                    port: Some(443),
                    source_port: Some(50_001),
                    destination_port: Some(443),
                    rule: None,
                    proxy: Some("JMS".into()),
                    upload: 50,
                    download: 300,
                    confidence: "high".into(),
                },
            ])
            .await
            .unwrap();

        let buckets = store.traffic_rank(Some(1_000_000_000_000), None).await.unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].host, "api.example.com");
        assert_eq!(buckets[0].upload, 150);
        assert_eq!(buckets[0].download, 500);
        assert_eq!(buckets[0].connection_count, 2);

        let totals = store.traffic_totals().await.unwrap();
        assert_eq!(totals.today_upload, 150);
        assert_eq!(totals.today_download, 500);
        assert_eq!(totals.total_upload, 150);
        assert_eq!(totals.total_download, 500);

        store
            .upsert_connections(vec![ConnectionEntry {
                connection_id: "a".into(),
                started_at: 1_000_000_000_000,
                observed_at: None,
                closed_at: None,
                process: Some("firefox.exe".into()),
                host: Some("api.example.com".into()),
                ip: Some("1.2.3.4".into()),
                port: Some(443),
                source_port: Some(50_000),
                destination_port: Some(443),
                rule: None,
                proxy: Some("JMS".into()),
                upload: 100,
                download: 200,
                confidence: "high".into(),
            }])
            .await
            .unwrap();
        let totals = store.traffic_totals().await.unwrap();
        assert_eq!(totals.total_upload, 150);
        assert_eq!(totals.total_download, 500);
        let dimension_count: i64 = store
            .reader
            .lock()
            .await
            .query_row("SELECT COUNT(*) FROM traffic_daily_dimensions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(dimension_count, 1);

        store
            .upsert_connections(vec![ConnectionEntry {
                connection_id: "a".into(),
                started_at: 1_000_000_000_000,
                observed_at: None,
                closed_at: None,
                process: Some("firefox.exe".into()),
                host: Some("api.example.com".into()),
                ip: Some("1.2.3.4".into()),
                port: Some(443),
                source_port: Some(50_000),
                destination_port: Some(443),
                rule: None,
                proxy: Some("JMS".into()),
                upload: 130,
                download: 260,
                confidence: "high".into(),
            }])
            .await
            .unwrap();

        let totals = store.traffic_totals().await.unwrap();
        assert_eq!(totals.total_upload, 180);
        assert_eq!(totals.total_download, 560);

        store
            .upsert_connections(vec![ConnectionEntry {
                connection_id: "a".into(),
                started_at: 1_000_000_000_000,
                observed_at: None,
                closed_at: None,
                process: Some("firefox.exe".into()),
                host: Some("api.example.com".into()),
                ip: Some("1.2.3.4".into()),
                port: Some(443),
                source_port: Some(50_000),
                destination_port: Some(443),
                rule: None,
                proxy: Some("JMS".into()),
                upload: 110,
                download: 220,
                confidence: "high".into(),
            }])
            .await
            .unwrap();
        let totals = store.traffic_totals().await.unwrap();
        assert_eq!(totals.total_upload, 180);
        assert_eq!(totals.total_download, 560);
        let persisted = store
            .reader
            .lock()
            .await
            .query_row(
                "SELECT upload, download FROM connections WHERE connection_id = 'a'",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .unwrap();
        assert_eq!(persisted, (130, 260));

        store
            .upsert_connections(vec![ConnectionEntry {
                connection_id: "a".into(),
                started_at: 1_000_000_000_000,
                observed_at: None,
                closed_at: None,
                process: Some("firefox.exe".into()),
                host: Some("cdn.example.com".into()),
                ip: Some("1.2.3.4".into()),
                port: Some(443),
                source_port: Some(50_000),
                destination_port: Some(443),
                rule: None,
                proxy: Some("JMS".into()),
                upload: 130,
                download: 260,
                confidence: "high".into(),
            }])
            .await
            .unwrap();
        let totals = store.traffic_totals().await.unwrap();
        assert_eq!(totals.total_upload, 180);
        assert_eq!(totals.total_download, 560);
        let buckets = store.traffic_rank(None, None).await.unwrap();
        assert_eq!(buckets.len(), 2);
        let api = buckets.iter().find(|bucket| bucket.host == "api.example.com").unwrap();
        assert_eq!((api.upload, api.download, api.connection_count), (50, 300, 1));
        let cdn = buckets.iter().find(|bucket| bucket.host == "cdn.example.com").unwrap();
        assert_eq!((cdn.upload, cdn.download, cdn.connection_count), (130, 260, 1));

        store.clear_traffic_history().await.unwrap();
        let totals = store.traffic_totals().await.unwrap();
        assert_eq!(totals.total_upload, 0);
        assert_eq!(totals.total_download, 0);

        store
            .upsert_connections(vec![ConnectionEntry {
                connection_id: "a".into(),
                started_at: 1_000_000_000_000,
                observed_at: None,
                closed_at: None,
                process: Some("firefox.exe".into()),
                host: Some("api.example.com".into()),
                ip: Some("1.2.3.4".into()),
                port: Some(443),
                source_port: Some(50_000),
                destination_port: Some(443),
                rule: None,
                proxy: Some("JMS".into()),
                upload: 150,
                download: 300,
                confidence: "high".into(),
            }])
            .await
            .unwrap();
        let totals = store.traffic_totals().await.unwrap();
        assert_eq!(totals.total_upload, 20);
        assert_eq!(totals.total_download, 40);
    }

    #[tokio::test]
    async fn pruning_raw_traffic_keeps_aggregates() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store
            .upsert_connections(vec![ConnectionEntry {
                connection_id: "old".into(),
                started_at: now_ms() - 4 * 24 * 60 * 60 * 1000,
                observed_at: None,
                closed_at: None,
                process: Some("firefox.exe".into()),
                host: Some("api.example.com".into()),
                ip: Some("1.2.3.4".into()),
                port: Some(443),
                source_port: Some(50_000),
                destination_port: Some(443),
                rule: None,
                proxy: Some("JMS".into()),
                upload: 10,
                download: 20,
                confidence: "high".into(),
            }])
            .await
            .unwrap();

        {
            let conn = store.writer.lock().await;
            conn.execute(
                "UPDATE connections SET last_seen_at = ?1 WHERE connection_id = 'old'",
                params![now_ms() - 4 * 24 * 60 * 60 * 1000],
            )
            .unwrap();
            conn.execute(
                "UPDATE traffic_daily_details SET day = date('now', 'localtime', '-3 days')
                 WHERE connection_id = 'old'",
                [],
            )
            .unwrap();
        }

        store.prune_expired().await.unwrap();

        let conn = store.reader.lock().await;
        let raw_connections: i64 = conn
            .query_row("SELECT COUNT(*) FROM connections", [], |row| row.get(0))
            .unwrap();
        let raw_details: i64 = conn
            .query_row("SELECT COUNT(*) FROM traffic_daily_details", [], |row| row.get(0))
            .unwrap();
        let daily_aggregates: i64 = conn
            .query_row("SELECT COUNT(*) FROM traffic_daily", [], |row| row.get(0))
            .unwrap();
        let dimension_aggregates: i64 = conn
            .query_row("SELECT COUNT(*) FROM traffic_daily_dimensions", [], |row| row.get(0))
            .unwrap();
        let (total_upload, total_download): (i64, i64) = conn
            .query_row("SELECT upload, download FROM traffic_totals WHERE id = 1", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(raw_connections, 0);
        assert_eq!(raw_details, 0);
        assert_eq!(daily_aggregates, 1);
        assert_eq!(dimension_aggregates, 1);
        assert_eq!((total_upload, total_download), (10, 20));
    }

    #[tokio::test]
    async fn traffic_deltas_keep_their_observed_calendar_day() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        let first_day = Local
            .with_ymd_and_hms(2026, 1, 1, 23, 59, 59)
            .single()
            .unwrap()
            .timestamp_millis();
        let second_day = Local
            .with_ymd_and_hms(2026, 1, 2, 0, 0, 1)
            .single()
            .unwrap()
            .timestamp_millis();

        store
            .upsert_connections(vec![
                ConnectionEntry {
                    connection_id: "cross-day".into(),
                    started_at: first_day,
                    observed_at: Some(first_day),
                    closed_at: None,
                    process: Some("app.exe".into()),
                    host: Some("example.com".into()),
                    ip: Some("1.2.3.4".into()),
                    port: Some(443),
                    source_port: Some(50_000),
                    destination_port: Some(443),
                    rule: None,
                    proxy: Some("Proxy".into()),
                    upload: 100,
                    download: 200,
                    confidence: "high".into(),
                },
                ConnectionEntry {
                    connection_id: "cross-day".into(),
                    started_at: first_day,
                    observed_at: Some(second_day),
                    closed_at: None,
                    process: Some("app.exe".into()),
                    host: Some("example.com".into()),
                    ip: Some("1.2.3.4".into()),
                    port: Some(443),
                    source_port: Some(50_000),
                    destination_port: Some(443),
                    rule: None,
                    proxy: Some("Proxy".into()),
                    upload: 150,
                    download: 260,
                    confidence: "high".into(),
                },
            ])
            .await
            .unwrap();

        let conn = store.reader.lock().await;
        let mut stmt = conn
            .prepare("SELECT day, upload, download FROM traffic_daily ORDER BY day")
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![("2026-01-01".to_string(), 100, 200), ("2026-01-02".to_string(), 50, 60),]
        );
    }

    #[tokio::test]
    async fn traffic_rank_splits_hosts_for_same_process() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store
            .upsert_connections(vec![
                ConnectionEntry {
                    connection_id: "panel".into(),
                    started_at: 1_000_000_000_000,
                    observed_at: None,
                    closed_at: None,
                    process: Some("firefox.exe".into()),
                    host: Some("api.synaglobal.vip".into()),
                    ip: Some("20.24.218.235".into()),
                    port: Some(443),
                    source_port: Some(50_000),
                    destination_port: Some(443),
                    rule: None,
                    proxy: Some("JMS".into()),
                    upload: 5_000_000,
                    download: 120_000_000,
                    confidence: "high".into(),
                },
                ConnectionEntry {
                    connection_id: "backup".into(),
                    started_at: 1_000_000_000_000,
                    observed_at: None,
                    closed_at: None,
                    process: Some("firefox.exe".into()),
                    host: Some("66.154.115.131".into()),
                    ip: Some("66.154.115.131".into()),
                    port: Some(80),
                    source_port: Some(50_001),
                    destination_port: Some(80),
                    rule: None,
                    proxy: Some("JMS".into()),
                    upload: 5_850_000_000,
                    download: 25_048_934_015,
                    confidence: "high".into(),
                },
            ])
            .await
            .unwrap();

        let buckets = store.traffic_rank(Some(1_000_000_000_000), None).await.unwrap();
        assert_eq!(buckets.len(), 2);
        assert_eq!(buckets[0].host, "66.154.115.131");
        assert_eq!(buckets[0].download, 25_048_934_015);
        assert_eq!(buckets[1].host, "api.synaglobal.vip");
    }

    #[test]
    fn parses_log_identity() {
        let payload = "[TCP] 127.0.0.1:50000(firefox.exe) --> api.example.com:443 match Match using JMS";
        let (process, host) = parse_log_identity(payload, 443).unwrap();
        assert_eq!(process, "firefox.exe");
        assert_eq!(host, "api.example.com");
    }

    #[tokio::test]
    async fn associates_connection_metadata_from_logs() {
        let (_dir, path) = temp_db();
        let store = SqliteLogStore::open(&path, 7).unwrap();
        store.push(LogEntry::new(
            1_000_000_000_000,
            "warning",
            "core",
            "[TCP] 127.0.0.1:50000(firefox.exe) --> api.example.com:443 match Match using JMS",
        ));
        tokio::time::sleep(Duration::from_millis(250)).await;
        store
            .upsert_connections(vec![ConnectionEntry {
                connection_id: "c1".into(),
                started_at: 1_000_000_000_000,
                observed_at: None,
                closed_at: None,
                process: None,
                host: None,
                ip: None,
                port: Some(443),
                source_port: Some(50_000),
                destination_port: Some(443),
                rule: None,
                proxy: None,
                upload: 0,
                download: 0,
                confidence: "high".into(),
            }])
            .await
            .unwrap();
        {
            let conn = store.writer.lock().await;
            conn.execute(
                "INSERT INTO traffic_daily_dimensions (
                   day, process, host, ip, proxy, upload, download, connection_count
                 ) VALUES ('2000-01-01', 'legacy.exe', 'legacy.example.com', '', '', 7, 11, 1)",
                [],
            )
            .unwrap();
        }

        let updated = store.associate_connections_from_logs().await.unwrap();
        assert_eq!(updated, 1);

        let buckets = store.traffic_rank(Some(1_000_000_000_000), None).await.unwrap();
        assert_eq!(buckets[0].process, "firefox.exe");
        assert_eq!(buckets[0].host, "api.example.com");
        let legacy_dimensions: i64 = store
            .reader
            .lock()
            .await
            .query_row(
                "SELECT COUNT(*) FROM traffic_daily_dimensions WHERE day = '2000-01-01'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy_dimensions, 1);
    }
}
