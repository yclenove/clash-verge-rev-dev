import { Close } from '@mui/icons-material'
import {
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import * as yaml from 'js-yaml'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getProfiles,
  lookupServersGeoip,
  readProfileFile,
} from '@/services/cmds'
import { getCountryFlag } from '@/utils/country'

import type { ProxyChainItem } from './proxy-chain-model'

interface PickerNode {
  profileUid: string
  profileName: string
  name: string
  type: string
  server?: string
  definition: Record<string, unknown>
}

interface ProxyChainPickerProps {
  open: boolean
  onClose: () => void
  onAdd: (item: ProxyChainItem) => void
  existingNames: Set<string>
}

const isSubscriptionProfile = (profile: IProfileItem) =>
  (profile.type === 'remote' || profile.type === 'local') && !!profile.file

export const ProxyChainPicker = ({
  open,
  onClose,
  onAdd,
  existingNames,
}: ProxyChainPickerProps) => {
  const theme = useTheme()
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [nodes, setNodes] = useState<PickerNode[]>([])
  const [geo, setGeo] = useState<Record<string, IServerGeoInfo>>({})
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setNodes([])
      setGeo({})
      try {
        const profiles = await getProfiles()
        const items = (profiles?.items ?? []).filter(isSubscriptionProfile)
        const collected: PickerNode[] = []
        const seenNames = new Set<string>()
        // Sequential load keeps first-wins name dedupe deterministic and
        // aligned with backend multi-sub merge.
        const ordered = [...items].sort((a, b) =>
          (a.name || a.uid).localeCompare(b.name || b.uid),
        )
        for (const profile of ordered) {
          if (cancelled) return
          try {
            const content = await readProfileFile(profile.uid)
            const parsed = yaml.load(content) as {
              proxies?: Array<Record<string, unknown>>
            } | null
            for (const proxy of parsed?.proxies ?? []) {
              const name =
                typeof proxy.name === 'string' ? proxy.name : undefined
              if (!name || seenNames.has(name)) continue
              seenNames.add(name)
              collected.push({
                profileUid: profile.uid,
                profileName: profile.name || profile.uid,
                name,
                type: typeof proxy.type === 'string' ? proxy.type : '',
                server:
                  typeof proxy.server === 'string' ? proxy.server : undefined,
                definition: proxy,
              })
            }
          } catch {
            // Skip profiles that cannot be read or parsed.
          }
        }
        if (cancelled) return
        collected.sort(
          (a, b) =>
            a.profileName.localeCompare(b.profileName) ||
            a.name.localeCompare(b.name),
        )
        setNodes(collected)

        const servers = Array.from(
          new Set(
            collected
              .map((node) => node.server)
              .filter((s): s is string => !!s),
          ),
        )
        if (servers.length > 0) {
          try {
            const geoMap = await lookupServersGeoip(servers)
            if (!cancelled) setGeo(geoMap ?? {})
          } catch {
            // GeoIP lookup is best-effort; ignore failures.
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return nodes
    return nodes.filter(
      (node) =>
        node.name.toLowerCase().includes(q) ||
        node.profileName.toLowerCase().includes(q) ||
        (node.server ?? '').toLowerCase().includes(q),
    )
  }, [nodes, query])

  const grouped = useMemo(() => {
    const map = new Map<string, { profileName: string; nodes: PickerNode[] }>()
    for (const node of filtered) {
      let entry = map.get(node.profileUid)
      if (!entry) {
        entry = { profileName: node.profileName, nodes: [] }
        map.set(node.profileUid, entry)
      }
      entry.nodes.push(node)
    }
    return Array.from(map.values())
  }, [filtered])

  const handleAdd = (node: PickerNode) => {
    const info = node.server ? geo[node.server] : undefined
    onAdd({
      id: `${node.name}_${node.profileUid}_${Date.now()}`,
      name: node.name,
      type: node.type,
      definition: node.definition,
      profileName: node.profileName,
      profileUid: node.profileUid,
      server: node.server,
      countryCode: info?.countryCode,
      country: info?.country,
      delay: undefined,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {t('proxies.page.chain.picker.title')}
        <IconButton size="small" onClick={onClose}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <TextField
          size="small"
          fullWidth
          placeholder={t('proxies.page.chain.picker.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ mb: 1.5 }}
        />
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : grouped.length === 0 ? (
          <Typography
            color="text.secondary"
            sx={{ textAlign: 'center', py: 6 }}
          >
            {t('proxies.page.chain.picker.empty')}
          </Typography>
        ) : (
          <Box sx={{ maxHeight: 480, overflow: 'auto' }}>
            {grouped.map(({ profileName, nodes: groupNodes }) => (
              <Box key={groupNodes[0].profileUid} sx={{ mb: 1.5 }}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    px: 1,
                    py: 0.5,
                    color: theme.palette.primary.main,
                    fontWeight: 700,
                  }}
                >
                  {profileName}
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 1 }}
                  >
                    {t('proxies.page.labels.nodeCount', {
                      count: groupNodes.length,
                    })}
                  </Typography>
                </Typography>
                <List dense disablePadding>
                  {groupNodes.map((node) => {
                    const info = node.server ? geo[node.server] : undefined
                    const added = existingNames.has(node.name)
                    return (
                      <ListItemButton
                        key={`${node.profileUid}_${node.name}`}
                        disabled={added}
                        onClick={() => handleAdd(node)}
                        sx={{ borderRadius: 1, py: 0.5 }}
                      >
                        <ListItemText
                          primary={
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                              }}
                            >
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 500,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {node.name}
                              </Typography>
                              {node.type && (
                                <Chip
                                  label={node.type}
                                  size="small"
                                  variant="outlined"
                                  sx={{ height: 18, fontSize: '0.65rem' }}
                                />
                              )}
                            </Box>
                          }
                          secondary={
                            <Box
                              component="span"
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                              }}
                            >
                              {node.server && (
                                <Typography
                                  component="span"
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {info?.ip ?? node.server}
                                </Typography>
                              )}
                              {(info?.countryCode || info?.country) && (
                                <Typography
                                  component="span"
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {`${getCountryFlag(info?.countryCode)} ${info?.country ?? info?.countryCode}`}
                                </Typography>
                              )}
                            </Box>
                          }
                        />
                        {added && (
                          <Chip
                            label={t('proxies.page.chain.picker.added')}
                            size="small"
                            sx={{ height: 20, fontSize: '0.65rem' }}
                          />
                        )}
                      </ListItemButton>
                    )
                  })}
                </List>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
