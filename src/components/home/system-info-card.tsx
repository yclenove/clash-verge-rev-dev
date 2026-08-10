import {
  AdminPanelSettingsOutlined,
  ComputerOutlined,
  DeveloperBoardOutlined,
  DnsOutlined,
  ExtensionOutlined,
  InfoOutlined,
  PublicOutlined,
  RefreshOutlined,
  SettingsOutlined,
} from '@mui/icons-material'
import {
  Box,
  Chip,
  Divider,
  IconButton,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { IP_INFO_QUERY_KEY } from '@/constants/ip-info-cache'
import { useClash } from '@/hooks/use-clash'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useServiceInstaller } from '@/hooks/use-service-installer'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import {
  useRulesData,
  useSystemData,
  useUptimeData,
} from '@/providers/app-data-context'
import { getIpInfo } from '@/services/api'
import { getSystemInfo } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { useQuery } from '@/services/query-client'
import { getCountryFlag } from '@/utils/country'
import { version as appVersion } from '@root/package.json'

import { EnhancedCard } from './enhanced-card'

// 将毫秒转换为时:分:秒格式
const formatUptime = (uptimeMs: number) => {
  const hours = Math.floor(uptimeMs / 3600000)
  const minutes = Math.floor((uptimeMs % 3600000) / 60000)
  const seconds = Math.floor((uptimeMs % 60000) / 1000)
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

// ---- 分区标题 --------------------------------------------------------------

const SectionHeader = memo(
  ({
    icon,
    label,
    color,
    dense = false,
  }: {
    icon: ReactNode
    label: string
    color: string
    dense?: boolean
  }) => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: dense ? 0.5 : 0.75,
        mb: dense ? 0.75 : 1.25,
      }}
    >
      <Box
        sx={{
          width: dense ? 18 : 22,
          height: dense ? 18 : 22,
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          bgcolor: `${color}1f`,
          '& svg': { fontSize: dense ? 12 : 14 },
        }}
      >
        {icon}
      </Box>
      <Typography
        sx={{
          fontSize: dense ? 11 : 12,
          fontWeight: 700,
          letterSpacing: dense ? 0.4 : 0.6,
          color,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Typography>
    </Box>
  ),
)
SectionHeader.displayName = 'SectionHeader'

// ---- 信息行 ----------------------------------------------------------------

const InfoRow = memo(
  ({
    label,
    value,
    mono,
    clickable,
    onClick,
    children,
    dense = false,
  }: {
    label: string
    value?: string
    mono?: boolean
    clickable?: boolean
    onClick?: () => void
    children?: ReactNode
    dense?: boolean
  }) => (
    <Stack
      direction="row"
      sx={{
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: dense ? 1 : 1.5,
        py: dense ? 0.15 : 0,
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ flexShrink: 0, fontSize: dense ? 11 : 13 }}
      >
        {label}
      </Typography>
      {children ?? (
        <Typography
          variant="body2"
          noWrap
          onClick={onClick}
          sx={{
            fontWeight: 'medium',
            minWidth: 0,
            maxWidth: '62%',
            fontSize: mono ? (dense ? 11 : 12) : dense ? 11 : 13,
            fontFamily: mono ? 'monospace' : undefined,
            lineHeight: dense ? 1.3 : undefined,
            ...(clickable
              ? {
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  '&:hover': { opacity: 0.7 },
                }
              : {}),
          }}
        >
          {value || '-'}
        </Typography>
      )}
    </Stack>
  ),
)
InfoRow.displayName = 'InfoRow'
// ---- 主组件 ----------------------------------------------------------------

export interface SystemInfoCardProps {
  /** 嵌入首页合并卡：不渲染外层 EnhancedCard */
  embedded?: boolean
  /** 紧凑字号与间距 */
  dense?: boolean
}

export const SystemInfoCard = ({
  embedded = false,
  dense = false,
}: SystemInfoCardProps = {}) => {
  const { t } = useTranslation()
  const theme = useTheme()
  const { verge, patchVerge } = useVerge()
  const navigate = useNavigate()
  const { isAdminMode, isSidecarMode, mutateSystemState } = useSystemState()
  const { installServiceAndRestartCore } = useServiceInstaller()

  // Clash 信息
  const { version: clashVersion } = useClash()
  const displayedMixedPort = useDisplayedMixedPort()
  const { rules } = useRulesData()
  const { uptime } = useUptimeData()
  const { systemProxyAddress } = useSystemData()
  const formattedUptime = useMemo(() => formatUptime(uptime), [uptime])

  // 出口 IP 信息（与当前节点卡共享缓存）
  const {
    data: ipInfo,
    isLoading: ipLoading,
    refetch: refetchIp,
  } = useQuery({
    queryKey: [IP_INFO_QUERY_KEY, displayedMixedPort],
    queryFn: () => getIpInfo(displayedMixedPort),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 30_000,
  })

  const [osInfo, setOsInfo] = useState('')

  // 初始化系统信息
  useEffect(() => {
    getSystemInfo()
      .then((info) => {
        const sysName = info.system_name
        let sysVersion = info.system_version

        if (
          sysName &&
          sysVersion.toLowerCase().startsWith(sysName.toLowerCase())
        ) {
          sysVersion = sysVersion.substring(sysName.length).trim()
        }

        setOsInfo(`${sysName} ${sysVersion}`)
      })
      .catch(console.error)
  }, [])

  // 导航到设置页面
  const goToSettings = useCallback(() => {
    navigate('/settings')
  }, [navigate])

  // 切换自启动状态
  const toggleAutoLaunch = useCallback(async () => {
    if (!verge) return
    try {
      await patchVerge({ enable_auto_launch: !verge.enable_auto_launch })
    } catch (err) {
      console.error('切换开机自启动状态失败:', err)
      showNotice.error(err)
    }
  }, [verge, patchVerge])

  // 点击运行模式处理,Sidecar或纯管理员模式允许安装服务
  const handleRunningModeClick = useCallback(async () => {
    if (!isSidecarMode) return
    try {
      await installServiceAndRestartCore()
      await mutateSystemState()
    } catch (error) {
      console.error('Failed to install service:', error)
      showNotice.error(error)
    }
  }, [isSidecarMode, installServiceAndRestartCore, mutateSystemState])

  // 是否启用自启动
  const autoLaunchEnabled = useMemo(
    () => verge?.enable_auto_launch || false,
    [verge],
  )

  // 仅 Sidecar 模式可点击安装服务（纯管理员+服务模式无需再装）
  const runningModeClickable = isSidecarMode

  // 获取模式图标
  const getModeIcon = () => {
    if (isAdminMode) {
      if (!isSidecarMode) {
        return (
          <>
            <AdminPanelSettingsOutlined
              sx={{ color: 'primary.main', fontSize: 16 }}
              titleAccess={t('home.components.systemInfo.badges.adminMode')}
            />
            <DnsOutlined
              sx={{ color: 'success.main', fontSize: 16, ml: 0.5 }}
              titleAccess={t('home.components.systemInfo.badges.serviceMode')}
            />
          </>
        )
      }
      return (
        <AdminPanelSettingsOutlined
          sx={{ color: 'primary.main', fontSize: 16 }}
          titleAccess={t('home.components.systemInfo.badges.adminMode')}
        />
      )
    } else if (isSidecarMode) {
      return (
        <ExtensionOutlined
          sx={{ color: 'info.main', fontSize: 16 }}
          titleAccess={t('home.components.systemInfo.badges.sidecarMode')}
        />
      )
    } else {
      return (
        <DnsOutlined
          sx={{ color: 'success.main', fontSize: 16 }}
          titleAccess={t('home.components.systemInfo.badges.serviceMode')}
        />
      )
    }
  }

  // 获取模式文本
  const getModeText = () => {
    if (isAdminMode) {
      if (!isSidecarMode) {
        return t('home.components.systemInfo.badges.adminServiceMode')
      }
      return t('home.components.systemInfo.badges.adminMode')
    } else if (isSidecarMode) {
      return t('home.components.systemInfo.badges.sidecarMode')
    } else {
      return t('home.components.systemInfo.badges.serviceMode')
    }
  }

  // verge 尚未加载时展示骨架，避免首页该区块完全空白
  if (!verge) {
    return (
      <EnhancedCard
        title={t('home.components.systemInfo.title')}
        icon={<InfoOutlined />}
      >
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'repeat(3, 1fr)',
          }}
        >
          {(['a', 'b', 'c', 'd', 'e', 'f'] as const).map((key) => (
            <Skeleton key={key} variant="rounded" height={48} />
          ))}
        </Box>
      </EnhancedCard>
    )
  }

  const cardTitle = t('home.components.systemInfo.title')
  const cardIcon = <InfoOutlined />
  const cardAction = (
    <Stack direction="row" spacing={0.25}>
      <Tooltip title={t('home.components.ipInfo.refresh')} arrow>
        <IconButton
          size="small"
          onClick={() => refetchIp()}
          disabled={ipLoading}
        >
          <RefreshOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('home.components.systemInfo.actions.settings')} arrow>
        <IconButton size="small" onClick={goToSettings}>
          <SettingsOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
  const cardBody = (
    <Box
      sx={{
        display: 'grid',
        gap: dense ? 1.25 : 2.5,
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
      }}
    >
      {/* Clash 信息分区 */}
      <Box sx={{ minWidth: 0 }}>
        <SectionHeader
          icon={<DeveloperBoardOutlined />}
          label={t('home.components.systemInfo.sections.clash')}
          color={theme.palette.warning.main}
          dense={dense}
        />
        <Stack spacing={dense ? 0.6 : 1.25}>
          <InfoRow
            dense={dense}
            label={t('home.components.clashInfo.fields.coreVersion')}
            value={clashVersion || '-'}
          />
          <Divider />
          <InfoRow
            dense={dense}
            label={t('home.components.clashInfo.fields.mixedPort')}
            value={String(displayedMixedPort)}
            mono
          />
          <Divider />
          <InfoRow
            dense={dense}
            label={t('home.components.clashInfo.fields.systemProxyAddress')}
            value={systemProxyAddress}
            mono
          />
          <Divider />
          <InfoRow
            dense={dense}
            label={t('home.components.clashInfo.fields.uptime')}
            value={formattedUptime}
            mono
          />
          <Divider />
          <InfoRow
            dense={dense}
            label={t('home.components.clashInfo.fields.rulesCount')}
            value={String(rules.length)}
          />
        </Stack>
      </Box>

      {/* 系统信息分区 */}
      <Box sx={{ minWidth: 0 }}>
        <SectionHeader
          icon={<ComputerOutlined />}
          label={t('home.components.systemInfo.sections.system')}
          color={theme.palette.error.main}
          dense={dense}
        />
        <Stack spacing={dense ? 0.6 : 1.25}>
          <InfoRow
            dense={dense}
            label={t('home.components.systemInfo.fields.osInfo')}
            value={osInfo}
          />
          <Divider />
          <InfoRow
            dense={dense}
            label={t('home.components.systemInfo.fields.vergeVersion')}
            value={`v${appVersion}`}
          />
          <Divider />
          <InfoRow
            dense={dense}
            label={t('home.components.systemInfo.fields.runningMode')}
          >
            <Typography
              variant="body2"
              onClick={handleRunningModeClick}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontWeight: 'medium',
                fontSize: dense ? 11 : 13,
                cursor: runningModeClickable ? 'pointer' : 'default',
                textDecoration: runningModeClickable ? 'underline' : 'none',
                '&:hover': { opacity: runningModeClickable ? 0.7 : 1 },
              }}
            >
              {getModeIcon()}
              {getModeText()}
            </Typography>
          </InfoRow>
          <Divider />
          <InfoRow
            dense={dense}
            label={t('home.components.systemInfo.fields.autoLaunch')}
          >
            <Chip
              size="small"
              label={
                autoLaunchEnabled
                  ? t('shared.statuses.enabled')
                  : t('shared.statuses.disabled')
              }
              color={autoLaunchEnabled ? 'success' : 'default'}
              variant={autoLaunchEnabled ? 'filled' : 'outlined'}
              onClick={toggleAutoLaunch}
              sx={{ cursor: 'pointer' }}
            />
          </InfoRow>
        </Stack>
      </Box>

      {/* 出口 IP 分区 */}
      <Box sx={{ minWidth: 0 }}>
        <SectionHeader
          icon={<PublicOutlined />}
          label={t('home.components.systemInfo.sections.network')}
          color={theme.palette.info.main}
          dense={dense}
        />
        {ipLoading && !ipInfo ? (
          <Stack spacing={dense ? 0.6 : 1.25}>
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width="90%" />
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="80%" />
          </Stack>
        ) : (
          <Stack spacing={dense ? 0.6 : 1.25}>
            <InfoRow
              dense={dense}
              label={t('home.components.ipInfo.labels.country')}
            >
              <Typography
                variant="body2"
                noWrap
                sx={{
                  fontWeight: 'medium',
                  fontSize: dense ? 11 : 13,
                  minWidth: 0,
                  maxWidth: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    fontSize: dense ? 14 : 18,
                    lineHeight: 1,
                    fontFamily: '"twemoji mozilla", sans-serif',
                  }}
                >
                  {getCountryFlag(ipInfo?.country_code)}
                </Box>
                {ipInfo?.country || t('home.components.ipInfo.labels.unknown')}
              </Typography>
            </InfoRow>
            <Divider />
            <InfoRow
              dense={dense}
              label={t('home.components.ipInfo.labels.location')}
              value={[ipInfo?.city, ipInfo?.region].filter(Boolean).join(', ')}
            />
            <Divider />
            <InfoRow
              dense={dense}
              label={t('home.components.ipInfo.labels.ip')}
              value={ipInfo?.ip}
              mono
            />
            <Divider />
            <InfoRow
              dense={dense}
              label={t('home.components.ipInfo.labels.asn')}
              value={
                ipInfo?.asn
                  ? `AS${ipInfo.asn}`
                  : t('shared.labels.notAvailable')
              }
              mono
            />
            <Divider />
            <InfoRow
              dense={dense}
              label={t('home.components.ipInfo.labels.isp')}
              value={ipInfo?.organization}
            />
            <Divider />
            <InfoRow
              dense={dense}
              label={t('home.components.ipInfo.labels.org')}
              value={ipInfo?.asn_organization}
            />
            <Divider />
            <InfoRow
              dense={dense}
              label={t('home.components.ipInfo.labels.timezone')}
              value={ipInfo?.timezone}
            />
          </Stack>
        )}
      </Box>
    </Box>
  )

  if (embedded) {
    return (
      <Box sx={{ px: dense ? 1.25 : 2, py: dense ? 1 : 1.5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            mb: dense ? 0.75 : 1.25,
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: dense ? 0.75 : 1,
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                color: 'error.main',
                '& svg': { fontSize: dense ? 16 : 18 },
              }}
            >
              {cardIcon}
            </Box>
            <Typography
              sx={{
                fontSize: dense ? 13 : 15,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {cardTitle}
            </Typography>
          </Box>
          <Box sx={{ flexShrink: 0 }}>{cardAction}</Box>
        </Box>
        {cardBody}
      </Box>
    )
  }

  return (
    <EnhancedCard
      title={cardTitle}
      icon={cardIcon}
      iconColor="error"
      action={cardAction}
      dense={dense}
    >
      {cardBody}
    </EnhancedCard>
  )
}
