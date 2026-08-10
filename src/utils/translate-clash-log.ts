/**
 * Translate mihomo / Clash core English log payloads into Chinese for display.
 *
 * Design:
 * - Ordered regex rules (more specific first)
 * - Capture groups fill `$1`, `$2`... in templates
 * - Unmatched payloads fall back to the original English text
 * - Export the rule list so callers can extend / unit-test easily
 */

type ClashLogTranslationRule = {
  /** Stable id for debugging / extension */
  id: string
  /** Match against the full English payload */
  pattern: RegExp
  /**
   * Chinese template. Use `$1`, `$2`... for capture groups,
   * or a function for more complex rewrites.
   */
  toChinese: string | ((match: RegExpMatchArray, payload: string) => string)
}

const replaceCaptures = (template: string, match: RegExpMatchArray): string =>
  template.replace(/\$(\d+)/g, (_, index: string) => {
    const value = match[Number(index)]
    return value == null ? '' : value
  })

/**
 * Built-in mihomo / Clash Meta log patterns.
 * Keep proprietary policy names (DIRECT / REJECT / PROXY ...) as-is.
 * Add new rules near related groups; prefer specific patterns over broad ones.
 */
const CLASH_LOG_TRANSLATION_RULES: ClashLogTranslationRule[] = [
  // ---------- Geodata / GeoSite / GeoIP ----------
  {
    id: 'geodata-loader-mode',
    pattern: /^Geodata Loader mode:\s*(.+)$/i,
    toChinese: (_m, payload) => {
      const mode = payload.replace(/^Geodata Loader mode:\s*/i, '').trim()
      const modeMap: Record<string, string> = {
        memconservative: '内存节约 (memconservative)',
        standard: '标准 (standard)',
      }
      return `地理数据加载模式：${modeMap[mode.toLowerCase()] ?? mode}`
    },
  },
  {
    id: 'finished-initial-geosite-rule',
    pattern:
      /^Finished initial GeoSite rule\s+(.+?)\s*=>\s*(.+?),\s*records:\s*(\d+)\s*$/i,
    toChinese: '已完成 GeoSite 规则初始化：$1 => $2，记录数：$3',
  },
  {
    id: 'finished-initial-geoip-rule',
    pattern:
      /^Finished initial GeoIP rule\s+(.+?)\s*=>\s*(.+?),\s*records:\s*(\d+)\s*$/i,
    toChinese: '已完成 GeoIP 规则初始化：$1 => $2，记录数：$3',
  },
  {
    id: 'start-initial-geosite-rule',
    pattern: /^Start initial GeoSite rule\s+(.+)$/i,
    toChinese: '开始初始化 GeoSite 规则：$1',
  },
  {
    id: 'start-initial-geoip-rule',
    pattern: /^Start initial GeoIP rule\s+(.+)$/i,
    toChinese: '开始初始化 GeoIP 规则：$1',
  },
  {
    id: 'load-geosite',
    pattern: /^(?:Load|load)\s+GeoSite(?:\s+dat)?(?::\s*(.+))?$/i,
    toChinese: (_m, payload) => {
      const detail = payload
        .replace(/^(?:Load|load)\s+GeoSite(?:\s+dat)?(?::\s*)?/i, '')
        .trim()
      return detail
        ? `正在加载 GeoSite 数据：${detail}`
        : '正在加载 GeoSite 数据'
    },
  },
  {
    id: 'load-geoip',
    pattern: /^(?:Load|load)\s+GeoIP(?:\s+(?:dat|mmdb))?(?::\s*(.+))?$/i,
    toChinese: (_m, payload) => {
      const detail = payload
        .replace(/^(?:Load|load)\s+GeoIP(?:\s+(?:dat|mmdb))?(?::\s*)?/i, '')
        .trim()
      return detail ? `正在加载 GeoIP 数据：${detail}` : '正在加载 GeoIP 数据'
    },
  },
  {
    id: 'load-mmdb',
    pattern: /^(?:Load|load)\s+MMDB(?::\s*(.+))?$/i,
    toChinese: (_m, payload) => {
      const detail = payload
        .replace(/^(?:Load|load)\s+MMDB(?::\s*)?/i, '')
        .trim()
      return detail ? `正在加载 MMDB：${detail}` : '正在加载 MMDB'
    },
  },
  {
    id: 'load-mmdb-failed',
    pattern: /^(?:Load|load)\s+MMDB failed:\s*(.+)$/i,
    toChinese: '加载 MMDB 失败：$1',
  },
  {
    id: 'cant-find-geoip-database',
    pattern: /^Can'?t find GeoIP database.*$/i,
    toChinese: '找不到 GeoIP 数据库，请检查 GeoIP 数据文件',
  },
  {
    id: 'cant-find-geosite-database',
    pattern: /^Can'?t find GeoSite database.*$/i,
    toChinese: '找不到 GeoSite 数据库，请检查 GeoSite 数据文件',
  },
  {
    id: 'geoip-database-loaded',
    pattern: /^GeoIP database loaded.*$/i,
    toChinese: 'GeoIP 数据库已加载',
  },
  {
    id: 'geosite-database-loaded',
    pattern: /^GeoSite database loaded.*$/i,
    toChinese: 'GeoSite 数据库已加载',
  },
  {
    id: 'update-geo-databases',
    pattern:
      /^(?:Start\s+)?(?:updating|update)\s+geo(?:data|IP|Site)?\s*databases?.*$/i,
    toChinese: '正在更新地理数据库',
  },
  {
    id: 'geo-databases-updated',
    pattern: /^geo(?:data|IP|Site)?\s*databases?\s+updated.*$/i,
    toChinese: '地理数据库已更新完成',
  },

  // ---------- Provider ----------
  {
    id: 'start-initial-compatible-provider',
    pattern: /^Start initial compatible provider\s+(.+)$/i,
    toChinese: '开始初始化兼容代理提供者：$1',
  },
  {
    id: 'start-initial-provider',
    pattern: /^Start initial provider\s+(.+)$/i,
    toChinese: '开始初始化代理提供者：$1',
  },
  {
    id: 'start-initial-rule-provider',
    pattern: /^Start initial rule[- ]?provider\s+(.+)$/i,
    toChinese: '开始初始化规则提供者：$1',
  },
  {
    id: 'provider-first-update-finished',
    pattern: /^(.+?)'s first update finished$/i,
    toChinese: '提供者 $1 首次更新完成',
  },
  {
    id: 'provider-updated',
    pattern: /^(?:Provider|provider)\s+(.+?)\s+(?:updated|update finished).*$/i,
    toChinese: '提供者 $1 已更新',
  },
  {
    id: 'provider-update-failed',
    pattern: /^(?:Provider|provider)\s+(.+?)\s+update failed(?::\s*(.+))?$/i,
    toChinese: (m) =>
      m[2] ? `提供者 ${m[1]} 更新失败：${m[2]}` : `提供者 ${m[1]} 更新失败`,
  },
  {
    id: 'rule-provider-updated',
    pattern:
      /^(?:Rule[- ]?provider|rule[- ]?provider)\s+(.+?)\s+(?:updated|update finished).*$/i,
    toChinese: '规则提供者 $1 已更新',
  },

  // ---------- Inbound / listener ----------
  {
    id: 'start-mixed-server',
    pattern: /^Start mixed server(?:\s+at|:)?\s*(.+)?$/i,
    toChinese: (m) =>
      m[1] ? `已启动 mixed 入站服务：${m[1].trim()}` : '已启动 mixed 入站服务',
  },
  {
    id: 'start-http-server',
    pattern: /^Start HTTP server(?:\s+at|:)?\s*(.+)?$/i,
    toChinese: (m) =>
      m[1] ? `已启动 HTTP 入站服务：${m[1].trim()}` : '已启动 HTTP 入站服务',
  },
  {
    id: 'start-socks-server',
    pattern: /^Start SOCKS(?:5)? server(?:\s+at|:)?\s*(.+)?$/i,
    toChinese: (m) =>
      m[1] ? `已启动 SOCKS 入站服务：${m[1].trim()}` : '已启动 SOCKS 入站服务',
  },
  {
    id: 'start-redir-server',
    pattern: /^Start redir server(?:\s+at|:)?\s*(.+)?$/i,
    toChinese: (m) =>
      m[1] ? `已启动 redir 入站服务：${m[1].trim()}` : '已启动 redir 入站服务',
  },
  {
    id: 'start-tproxy-server',
    pattern: /^Start tproxy server(?:\s+at|:)?\s*(.+)?$/i,
    toChinese: (m) =>
      m[1]
        ? `已启动 tproxy 入站服务：${m[1].trim()}`
        : '已启动 tproxy 入站服务',
  },
  {
    id: 'start-tun-interface',
    pattern: /^(?:Start|Starting)\s+TUN(?:\s+interface| device)?.*$/i,
    toChinese: '正在启动 TUN 接口',
  },
  {
    id: 'tun-enabled',
    pattern: /^TUN (?:enabled|device enabled).*$/i,
    toChinese: 'TUN 已启用',
  },
  {
    id: 'tun-disabled',
    pattern: /^TUN (?:disabled|device disabled).*$/i,
    toChinese: 'TUN 已关闭',
  },
  {
    id: 'external-controller',
    pattern: /^RESTful API listening at:\s*(.+)$/i,
    toChinese: '外部控制器正在监听：$1',
  },
  {
    id: 'inbound-listening',
    pattern: /^(.+?)\s+listening at:\s*(.+)$/i,
    toChinese: '$1 正在监听：$2',
  },
  {
    id: 'ui-path',
    pattern: /^UI path:\s*(.+)$/i,
    toChinese: 'UI 路径：$1',
  },

  // ---------- DNS ----------
  {
    id: 'dns-enabled',
    pattern: /^\[DNS\]\s*(?:enabled|Enable).*$/i,
    toChinese: '[DNS] 已启用',
  },
  {
    id: 'dns-disabled',
    pattern: /^\[DNS\]\s*(?:disabled|Disable).*$/i,
    toChinese: '[DNS] 已关闭',
  },
  {
    id: 'dns-enhance',
    pattern: /^\[DNS\]\s*(.+)$/i,
    toChinese: '[DNS] $1',
  },
  {
    id: 'start-dns-tcp-error',
    pattern: /^Start DNS server\(TCP\) error:\s*(.+)$/i,
    toChinese: 'DNS 服务（TCP）启动失败：$1',
  },
  {
    id: 'start-dns-udp-error',
    pattern: /^Start DNS server\(UDP\) error:\s*(.+)$/i,
    toChinese: 'DNS 服务（UDP）启动失败：$1',
  },
  {
    id: 'start-dns-error',
    pattern: /^Start DNS server error:\s*(.+)$/i,
    toChinese: 'DNS 服务启动失败：$1',
  },
  {
    id: 'start-dns',
    pattern: /^(?:Start|Starting)\s+DNS(?:\s+server)?(?:\.{3})?$/i,
    toChinese: '正在启动 DNS 服务',
  },

  // ---------- Config / runtime ----------
  {
    id: 'config-initializing',
    pattern: /^(?:Start|Starting)\s+initial(?:izing)? configuration.*$/i,
    toChinese: '正在初始化配置',
  },
  {
    id: 'config-initial-finished',
    pattern: /^Initial configuration complete.*$/i,
    toChinese: '配置初始化完成',
  },
  {
    id: 'apply-config',
    pattern: /^(?:Apply|Applying)\s+config.*$/i,
    toChinese: '正在应用配置',
  },
  {
    id: 'reload-config',
    pattern: /^(?:Reload|Reloading)\s+config.*$/i,
    toChinese: '正在重新加载配置',
  },
  {
    id: 'config-loaded',
    pattern: /^Configuration loaded.*$/i,
    toChinese: '配置已加载',
  },
  {
    id: 'sniffer-enabled',
    pattern: /^Sniffer (?:is )?(?:enabled|Enable).*$/i,
    toChinese: '流量嗅探已启用',
  },
  {
    id: 'sniffer-disabled',
    pattern: /^Sniffer (?:is )?(?:disabled|Disable).*$/i,
    toChinese: '流量嗅探已关闭',
  },

  // ---------- Connection match ----------
  {
    id: 'match-rule-using',
    pattern:
      /^\[(.+?)\]\s+(.+?)\s*-->\s*(.+?)\s+match\s+(.+?)\s+using\s+(.+)$/i,
    toChinese: '[$1] $2 --> $3 匹配 $4，使用 $5',
  },
  {
    id: 'match-rule-arrow',
    pattern: /^\[(.+?)\]\s+(.+?)\s*-->\s*(.+?)\s+match\s+(.+)$/i,
    toChinese: '[$1] $2 --> $3 匹配 $4',
  },
  {
    id: 'match-rule-simple',
    pattern: /^\[(.+?)\]\s+(.+?)\s*-->\s*(.+?)\s+using\s+(.+)$/i,
    toChinese: '[$1] $2 --> $3 使用 $4',
  },
  {
    id: 'match-generic',
    pattern: /^\[(.+?)\]\s+(.+?)\s*-->\s*(.+?)(?:\s+match\s+(.+))?$/i,
    toChinese: (m) =>
      m[4]
        ? `[${m[1]}] ${m[2]} --> ${m[3]} 匹配 ${m[4]}`
        : `[${m[1]}] ${m[2]} --> ${m[3]} 已匹配`,
  },

  // ---------- Proxy / dialer ----------
  {
    id: 'proxy-connecting',
    pattern: /^(?:Connecting|connecting) to\s+(.+)$/i,
    toChinese: '正在连接：$1',
  },
  {
    id: 'proxy-connected',
    pattern: /^(?:Connected|connected) to\s+(.+)$/i,
    toChinese: '已连接到 $1',
  },
  {
    id: 'proxy-dial-failed',
    pattern: /^(?:Dial|dial)\s+(.+?)\s+error(?::\s*(.+))?$/i,
    toChinese: (m) =>
      m[2] ? `拨号 ${m[1]} 出错：${m[2]}` : `拨号 ${m[1]} 失败`,
  },
  {
    id: 'health-check',
    pattern: /^(?:Start|Starting)\s+health check(?:\s+for\s+(.+))?.*$/i,
    toChinese: (m) => (m[1] ? `开始健康检查：${m[1]}` : '开始健康检查'),
  },
  {
    id: 'health-check-finished',
    pattern: /^Health check(?:\s+for\s+(.+))?\s+finished.*$/i,
    toChinese: (m) => (m[1] ? `健康检查完成：${m[1]}` : '健康检查完成'),
  },

  // ---------- Auth / misc ----------
  {
    id: 'authentication-failed',
    pattern: /^Authentication of\s+(.+?)\s+failed.*$/i,
    toChinese: '身份验证失败：$1',
  },
  {
    id: 'authentication-success',
    pattern: /^Authentication of\s+(.+?)\s+(?:success|succeeded).*$/i,
    toChinese: '身份验证成功：$1',
  },
  {
    id: 'websocket-error',
    pattern: /^Websocket error(?::\s*(.+))?$/i,
    toChinese: (m) => (m[1] ? `WebSocket 错误：${m[1]}` : 'WebSocket 错误'),
  },
  {
    id: 'start-process',
    pattern: /^Start process.*$/i,
    toChinese: '正在启动进程',
  },
  {
    id: 'shutdown',
    pattern: /^(?:Shutting down|Shutdown|shutdown).*$/i,
    toChinese: '正在关闭',
  },
  {
    id: 'rule-match-fallback',
    pattern: /^Match\s+(.+?)\s+using\s+(.+)$/i,
    toChinese: '匹配 $1，使用 $2',
  },
  {
    id: 'use-mode',
    pattern: /^(?:Use|Using|Set)\s+mode:\s*(.+)$/i,
    toChinese: '当前模式：$1',
  },
  {
    id: 'mode-changed',
    pattern: /^Mode changed to\s+(.+)$/i,
    toChinese: '模式已切换为：$1',
  },
  {
    id: 'level-changed',
    pattern: /^Log level changed to\s+(.+)$/i,
    toChinese: '日志等级已切换为：$1',
  },
  {
    id: 'finished-initial-generic',
    pattern: /^Finished initial\s+(.+)$/i,
    toChinese: '已完成初始化：$1',
  },
  {
    id: 'start-initial-generic',
    pattern: /^Start initial\s+(.+)$/i,
    toChinese: '开始初始化：$1',
  },
]

/**
 * Translate a single core log payload.
 * Returns the original string when no rule matches or translation throws.
 */
export function translateClashLogPayload(payload: string): string {
  if (!payload) return payload

  for (const rule of CLASH_LOG_TRANSLATION_RULES) {
    const match = payload.match(rule.pattern)
    if (!match) continue

    try {
      if (typeof rule.toChinese === 'function') {
        const translated = rule.toChinese(match, payload)
        if (translated) return translated
        continue
      }
      return replaceCaptures(rule.toChinese, match)
    } catch {
      // fall through to next rule / original text
    }
  }

  return payload
}

/**
 * Whether the UI language should show Chinese core-log translations.
 */
export function shouldTranslateClashLog(language?: string | null): boolean {
  if (!language) return false
  const normalized = language.toLowerCase()
  return normalized === 'zh' || normalized.startsWith('zh-')
}

/**
 * Build search haystack: time + type + original payload + translated payload.
 * Keeps English keyword search working after Chinese display translation.
 */
export function buildClashLogSearchText(
  item: Pick<ILogItem, 'time' | 'type' | 'payload'>,
  options?: { language?: string | null; translate?: boolean },
): string {
  const parts = [item.time || '', item.type, item.payload]
  const enableTranslate =
    options?.translate ?? shouldTranslateClashLog(options?.language)

  if (enableTranslate) {
    const translated = translateClashLogPayload(item.payload)
    if (translated && translated !== item.payload) {
      parts.push(translated)
    }
  }

  return parts.join(' ')
}

/**
 * Resolve the display payload for a log row.
 */
export function resolveClashLogDisplayPayload(
  payload: string,
  language?: string | null,
): string {
  if (!shouldTranslateClashLog(language)) return payload
  return translateClashLogPayload(payload)
}
