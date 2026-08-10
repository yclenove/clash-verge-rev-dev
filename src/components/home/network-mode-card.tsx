import { TuneRounded } from '@mui/icons-material'
import { Box, Grid, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'

import { ClashModeCard } from '@/components/home/clash-mode-card'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { ProxyTunCard } from '@/components/home/proxy-tun-card'
import type { TranslationKey } from '@/types/generated/i18n-keys'
import getSystem from '@/utils/get-system'

// 分节小标题（与订阅合并卡的分组标题风格保持一致）
const SectionLabel = ({
  labelKey,
  dense,
}: {
  labelKey: TranslationKey
  dense?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        mb: dense ? 0.4 : 0.75,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: dense ? 0.4 : 0.6,
        fontSize: dense ? 10 : undefined,
        color: 'text.secondary',
      }}
    >
      {t(labelKey)}
    </Typography>
  )
}

export interface NetworkModeCardProps {
  /** 嵌入首页合并卡：不渲染外层 EnhancedCard */
  embedded?: boolean
  /** 紧凑间距与字号 */
  dense?: boolean
}

// 网络与模式合并卡片：左栏代理模式切换，右栏系统代理 / TUN 网络设置
export const NetworkModeCard = ({
  embedded = false,
  dense = false,
}: NetworkModeCardProps = {}) => {
  const { t } = useTranslation()
  const isOhos = getSystem() === 'ohos'

  const body = (
    <Grid container spacing={dense ? 1 : 2} columns={12}>
      <Grid size={{ xs: 12, md: isOhos ? 12 : 6 }}>
        <SectionLabel labelKey="home.page.cards.proxyMode" dense={dense} />
        <ClashModeCard dense={dense} />
      </Grid>
      {!isOhos && (
        <Grid size={{ xs: 12, md: 6 }}>
          <SectionLabel
            labelKey="home.page.cards.networkSettings"
            dense={dense}
          />
          <ProxyTunCard dense={dense} />
        </Grid>
      )}
    </Grid>
  )

  if (embedded) {
    return (
      <Box sx={{ px: dense ? 1.25 : 2, py: dense ? 1 : 1.5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mb: dense ? 0.75 : 1.25,
          }}
        >
          <TuneRounded
            sx={{ fontSize: dense ? 16 : 18, color: 'primary.main' }}
          />
          <Typography
            sx={{
              fontSize: dense ? 13 : 15,
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            {t('home.page.cards.networkMode')}
          </Typography>
        </Box>
        {body}
      </Box>
    )
  }

  return (
    <EnhancedCard
      title={t('home.page.cards.networkMode')}
      icon={<TuneRounded />}
      iconColor="primary"
      action={null}
      dense={dense}
    >
      {body}
    </EnhancedCard>
  )
}
