use super::{CmdResult, WithErrorCode as _, coded_error};
use crate::feat;
use crate::utils::{dirs, yaml_emitter};
use crate::{
    cmd::StringifyErr as _,
    config::{ClashInfo, Config},
    constants,
    core::{
        CoreManager, handle, log_store,
        manager::CLASH_LOGGER,
        validate::{CoreConfigValidator, ValidationOutcome},
    },
};
use clash_verge_logging::{Type, logging, logging_error};
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use tokio::fs;

/// 复制Clash环境变量
#[tauri::command]
pub async fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env().await;
    Ok(())
}

/// 获取Clash信息
#[tauri::command]
pub async fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().await.data_arc().get_client_info())
}

/// 修改Clash配置
#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    feat::patch_clash(&payload)
        .await
        .with_error_code("CLASH_CONFIG_UPDATE_FAILED")
}

/// 修改Clash模式
///
/// 将 `change_clash_mode` 的失败上抛给前端，使前端 `catch` 能真正感知后端 PATCH 失败
/// 并提示用户（此前命令始终返回 `Ok(())`，吞掉了后端错误）。
#[tauri::command]
pub async fn patch_clash_mode(payload: String) -> CmdResult {
    feat::change_clash_mode(payload)
        .await
        .with_error_code("CLASH_MODE_UPDATE_FAILED")
}

/// 获取当前 Clash 模式（容错读取）
///
/// 直接读取已保存的 clash 配置中的 `mode`，绕开 mihomo `/configs` 的严格
/// `BaseConfig` 反序列化，作为主页 mode 显示的兜底来源。
#[tauri::command]
pub async fn get_clash_mode() -> CmdResult<Option<String>> {
    Ok(Config::clash().await.data_arc().get_mode().map(Into::into))
}

/// 切换Clash核心
#[tauri::command]
pub async fn change_clash_core(clash_core: String) -> CmdResult<Option<String>> {
    logging!(info, Type::Config, "changing core to {clash_core}");

    match CoreManager::global().change_core(&clash_core).await {
        Ok(_) => {
            logging_error!(Type::Core, Config::profiles().await.data_arc().save_file().await);

            // 切换内核后重启内核
            match CoreManager::global().restart_core().await {
                Ok(_) => {
                    logging!(info, Type::Core, "core changed and restarted to {clash_core}");
                    handle::Handle::notice_message("config_core::change_success", clash_core);
                    handle::Handle::refresh_clash();
                    Ok(None)
                }
                Err(err) => {
                    let error_msg: String = format!("Core changed but failed to restart: {err}").into();
                    handle::Handle::notice_message("config_core::change_error", error_msg.clone());
                    logging!(error, Type::Core, "{error_msg}");
                    Ok(Some(coded_error("CORE_CHANGE_FAILED", error_msg)))
                }
            }
        }
        Err(err) => {
            let error_msg: String = err;
            logging!(error, Type::Core, "failed to change core: {error_msg}");
            handle::Handle::notice_message("config_core::change_error", error_msg.clone());
            Ok(Some(coded_error("CORE_CHANGE_FAILED", error_msg)))
        }
    }
}

/// 启动核心
#[tauri::command]
pub async fn start_core() -> CmdResult {
    let result = CoreManager::global()
        .start_core()
        .await
        .with_error_code("CORE_START_FAILED");
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 关闭核心
#[tauri::command]
pub async fn stop_core() -> CmdResult {
    logging_error!(Type::Core, Config::profiles().await.data_arc().save_file().await);
    let result = CoreManager::global()
        .stop_core()
        .await
        .with_error_code("CORE_STOP_FAILED");
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 重启核心
#[tauri::command]
pub async fn restart_core() -> CmdResult {
    logging_error!(Type::Core, Config::profiles().await.data_arc().save_file().await);
    let result = CoreManager::global()
        .restart_core()
        .await
        .with_error_code("CORE_RESTART_FAILED");
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 测试URL延迟
#[tauri::command]
pub async fn test_delay(url: String) -> CmdResult<u32> {
    let result = match feat::test_delay(url).await {
        Ok(delay) => delay,
        Err(e) => {
            logging!(error, Type::Cmd, "{}", e);
            10000u32
        }
    };
    Ok(result)
}

/// 保存DNS配置到单独文件
#[tauri::command]
pub async fn save_dns_config(mut dns_config: Mapping) -> CmdResult {
    use crate::utils::dirs;
    use tokio::fs;

    // 获取DNS配置文件路径
    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    if crate::utils::dns_config::normalize_dns_listen(&mut dns_config) {
        logging!(
            warn,
            Type::Config,
            "migrated legacy Linux DNS listener to 127.0.0.1:1053"
        );
    }

    // 保存DNS配置到文件
    let yaml_str = yaml_emitter::to_mihomo_config_string(&dns_config).stringify_err()?;
    fs::write(&dns_path, yaml_str).await.stringify_err()?;
    logging!(info, Type::Config, "DNS config saved to {dns_path:?}");

    Ok(())
}

/// 应用或撤销DNS配置
#[tauri::command]
pub async fn apply_dns_config(apply: bool) -> CmdResult {
    if apply {
        // 读取DNS配置文件
        let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

        if !dns_path.exists() {
            logging!(warn, Type::Config, "DNS config file not found");
            return Err("DNS config file not found".into());
        }

        let dns_yaml = fs::read_to_string(&dns_path).await.stringify_err_log(|e| {
            logging!(error, Type::Config, "Failed to read DNS config: {e}");
        })?;

        // 解析DNS配置
        let patch_config = serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&dns_yaml).stringify_err_log(|e| {
            logging!(error, Type::Config, "Failed to parse DNS config: {e}");
        })?;

        logging!(info, Type::Config, "Applying DNS config from file");

        // 创建包含DNS配置的patch
        let mut patch = serde_yaml_ng::Mapping::new();
        patch.insert("dns".into(), patch_config.into());

        // 应用DNS配置到运行时配置
        Config::runtime().await.edit_draft(|d| {
            d.patch_config(&patch);
        });

        // 应用新配置
        CoreManager::global()
            .update_config_checked()
            .await
            .stringify_err_log(|err| {
                let err = format!("Failed to apply config with DNS: {err}");
                logging!(error, Type::Config, "{err}");
            })?;

        logging!(info, Type::Config, "DNS config successfully applied");
    } else {
        // 当关闭DNS设置时，重新生成配置（不加载DNS配置文件）
        logging!(info, Type::Config, "DNS settings disabled, regenerating config");

        CoreManager::global()
            .update_config_checked()
            .await
            .stringify_err_log(|err| {
                let err = format!("Failed to apply regenerated config: {err}");
                logging!(error, Type::Config, "{err}");
            })?;

        logging!(info, Type::Config, "Config regenerated successfully");
    }

    handle::Handle::refresh_clash();
    Ok(())
}

/// 检查DNS配置文件是否存在
#[tauri::command]
pub fn check_dns_config_exists() -> CmdResult<bool> {
    use crate::utils::dirs;

    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    Ok(dns_path.exists())
}

/// 获取DNS配置文件内容
#[tauri::command]
pub async fn get_dns_config_content() -> CmdResult<String> {
    use crate::utils::dirs;
    use tokio::fs;

    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    if !fs::try_exists(&dns_path).await.stringify_err()? {
        return Err("DNS config file not found".into());
    }

    let content = fs::read_to_string(&dns_path).await.stringify_err()?.into();
    Ok(content)
}

/// 验证DNS配置文件
#[tauri::command]
pub async fn validate_dns_config() -> CmdResult<ValidationOutcome> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    let dns_path = app_dir.join(constants::files::DNS_CONFIG);
    let dns_path_str = dns_path.to_str().unwrap_or_default();

    if !dns_path.exists() {
        return Ok(ValidationOutcome::invalid_from_message("DNS config file not found"));
    }

    CoreConfigValidator::validate_config_file_outcome(dns_path_str, None)
        .await
        .stringify_err()
}

#[tauri::command]
pub async fn get_clash_logs(
    from_ts: Option<i64>,
    to_ts: Option<i64>,
    level: Option<String>,
    source: Option<String>,
    limit: Option<i64>,
    cursor_ts: Option<i64>,
    cursor_id: Option<i64>,
    descending: Option<bool>,
) -> CmdResult<log_store::LogPage> {
    log_store::init_global().stringify_err()?;
    let query = log_store::LogQuery {
        from_ts,
        to_ts,
        level: level.map(|value| value.to_string()),
        source: source.map(|value| value.to_string()),
        limit,
        cursor_ts,
        cursor_id,
        descending,
    };
    CoreManager::global().get_clash_logs(query).await.stringify_err()
}

#[tauri::command]
pub async fn save_connections(entries: Vec<log_store::ConnectionEntry>) -> CmdResult<usize> {
    log_store::init_global().stringify_err()?;
    let Some(store) = log_store::get() else {
        return Err("sqlite log store is unavailable".into());
    };
    store.upsert_connections(entries).await.stringify_err()
}

#[tauri::command]
pub async fn get_traffic_rank(from_ts: Option<i64>, to_ts: Option<i64>) -> CmdResult<Vec<log_store::TrafficBucket>> {
    log_store::init_global().stringify_err()?;
    let Some(store) = log_store::get() else {
        return Err("sqlite log store is unavailable".into());
    };
    store.traffic_rank(from_ts, to_ts).await.stringify_err()
}

#[tauri::command]
pub async fn get_traffic_totals() -> CmdResult<log_store::TrafficTotals> {
    log_store::init_global().stringify_err()?;
    let Some(store) = log_store::get() else {
        return Err("sqlite log store is unavailable".into());
    };
    store.traffic_totals().await.stringify_err()
}

#[tauri::command]
pub async fn clear_traffic_history() -> CmdResult<usize> {
    log_store::init_global().stringify_err()?;
    let Some(store) = log_store::get() else {
        return Err("sqlite log store is unavailable".into());
    };
    store.clear_traffic_history().await.stringify_err()
}

#[derive(Debug, serde::Deserialize)]
pub struct IncomingClashLog {
    pub ts: i64,
    pub level: std::string::String,
    #[serde(default = "default_clash_log_source")]
    pub source: std::string::String,
    pub payload: std::string::String,
}

fn default_clash_log_source() -> std::string::String {
    std::string::String::from("core")
}

#[tauri::command]
pub async fn append_clash_logs(entries: Vec<IncomingClashLog>) -> CmdResult<usize> {
    log_store::init_global().stringify_err()?;
    let Some(store) = log_store::get() else {
        return Err("sqlite log store is unavailable".into());
    };
    let mapped = entries
        .into_iter()
        .map(|entry| log_store::LogEntry::new(entry.ts, entry.level, entry.source, entry.payload))
        .collect();
    store.append_entries(mapped).await.stringify_err()
}

#[tauri::command]
pub async fn clear_clash_logs() -> CmdResult<usize> {
    log_store::init_global().stringify_err()?;
    CLASH_LOGGER.clear_logs().await;
    let Some(store) = log_store::get() else {
        return Err("sqlite log store is unavailable".into());
    };
    store.clear_logs().await.stringify_err()
}
