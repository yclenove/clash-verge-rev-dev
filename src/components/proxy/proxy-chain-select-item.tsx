import { Box, Chip, ListItemButton, Typography, alpha } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

import { formatGeoParts } from '@/hooks/use-servers-geoip'
import delayManager from '@/services/delay'
import {
  memberDetails,
  type ProxyGroupView,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { getCountryFlag } from '@/utils/country'

import { useProxyNodeMeta } from './proxy-node-meta-context'

interface Props {
  group: ProxyGroupView
  member: ResolvedProxyMember
  selected?: boolean
  sx?: SxProps<Theme>
  onClick?: (member: ResolvedProxyMember) => void
}

/**
 * Chain-mode node row matching the multi-sub picker (图2):
 * full name + type chip, secondary IP + flag + country.
 */
export const ProxyChainSelectItem = ({
  group,
  member,
  selected = false,
  sx,
  onClick,
}: Props) => {
  const { serverByName, geoByServer } = useProxyNodeMeta()
  const unresolved = member.kind === 'unresolved'
  const name = member.ref.name
  const details = memberDetails(member)
  const type = unresolved
    ? member.ref.reason
    : (details?.type ?? (member.kind === 'node' ? member.node.type : ''))
  const server = serverByName.get(name)
  const geo = server ? geoByServer[server] : undefined
  const { ip, region } = formatGeoParts(server, geo, getCountryFlag)
  const delayValue = unresolved
    ? -1
    : delayManager.getDelayFix(member, group.name)

  return (
    <Box sx={sx}>
      <ListItemButton
        dense
        disabled={unresolved}
        selected={!unresolved && selected}
        onClick={unresolved ? undefined : () => onClick?.(member)}
        sx={{
          borderRadius: 1,
          mx: 1.5,
          mb: 0.25,
          px: 1.25,
          py: 0.75,
          alignItems: 'flex-start',
          gap: 1,
          '&.Mui-selected': {
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
          },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <Typography
              variant="body2"
              title={name}
              sx={{
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}
            >
              {name}
            </Typography>
            {!!type && (
              <Chip
                label={type}
                size="small"
                variant="outlined"
                sx={{
                  height: 18,
                  fontSize: '0.65rem',
                  flexShrink: 0,
                  '& .MuiChip-label': { px: 0.75 },
                }}
              />
            )}
          </Box>
          {(ip || region) && (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              title={[ip, region].filter(Boolean).join(' ')}
              sx={{ display: 'block', mt: 0.15, lineHeight: 1.35 }}
            >
              {[ip, region].filter(Boolean).join(' ')}
            </Typography>
          )}
        </Box>
        {!unresolved && delayValue > 0 && (
          <Typography
            variant="caption"
            sx={{
              flexShrink: 0,
              mt: 0.25,
              fontWeight: 600,
              color: delayManager.formatDelayColor(delayValue),
              minWidth: 36,
              textAlign: 'right',
            }}
          >
            {delayManager.formatDelay(delayValue)}
          </Typography>
        )}
      </ListItemButton>
    </Box>
  )
}
