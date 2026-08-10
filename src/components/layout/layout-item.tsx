import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from '@dnd-kit/core'
import {
  Badge,
  Box,
  alpha,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import { useCallback } from 'react'
import { useMatch, useNavigate, useResolvedPath } from 'react-router'

import { useVerge } from '@/hooks/use-verge'

interface SortableProps {
  setNodeRef?: (element: HTMLElement | null) => void
  attributes?: DraggableAttributes
  listeners?: DraggableSyntheticListeners
  style?: CSSProperties
  isDragging?: boolean
  disabled?: boolean
}

interface Props {
  to: string
  children: string
  icon: ReactNode[]
  sortable?: SortableProps
  /** Unread high-severity count shown as a badge (e.g. Logs warnings). */
  badgeCount?: number
  /** Called when the item is activated (before navigate). */
  onActivate?: () => void
}
export const LayoutItem = (props: Props) => {
  const { to, children, icon, sortable, badgeCount = 0, onActivate } = props
  const { verge } = useVerge()
  const { menu_icon } = verge ?? {}
  const navCollapsed = verge?.collapse_navbar ?? false
  const resolved = useResolvedPath(to)
  const match = useMatch({ path: resolved.pathname, end: true })
  const navigate = useNavigate()

  const effectiveMenuIcon =
    navCollapsed && menu_icon === 'disable' ? 'monochrome' : menu_icon

  const { setNodeRef, attributes, listeners, style, isDragging, disabled } =
    sortable ?? {}

  const draggable = Boolean(sortable) && !disabled
  const { onPointerDown, ...otherListeners } = draggable
    ? (listeners ?? {})
    : {}

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      onPointerDown?.(event)
    },
    [onPointerDown],
  )

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={[
        { py: 0.25, maxWidth: 156, mx: 'auto', padding: '2px 0px' },
        isDragging ? { opacity: 0.78 } : {},
      ]}
    >
      <ListItemButton
        selected={!!match}
        {...(draggable ? (attributes ?? {}) : {})}
        {...(draggable ? otherListeners : {})}
        sx={[
          {
            borderRadius: 1.5,
            marginLeft: 0.75,
            paddingLeft: 0.75,
            paddingRight: 0.75,
            marginRight: 0.75,
            minHeight: 36,
            cursor: draggable ? 'grab' : 'pointer',
            '&:active': draggable ? { cursor: 'grabbing' } : {},
            '& .MuiListItemText-primary': {
              color: 'text.primary',
              fontWeight: 500,
              fontSize: 13,
              lineHeight: 1.2,
            },
          },
          ({ palette: { mode, primary } }) => {
            const bgcolor =
              mode === 'light'
                ? alpha(primary.main, 0.15)
                : alpha(primary.main, 0.35)
            const color = mode === 'light' ? '#1f1f1f' : '#ffffff'
            return {
              '&.Mui-selected': { bgcolor },
              '&.Mui-selected:hover': { bgcolor },
              '&.Mui-selected .MuiListItemText-primary': { color },
            }
          },
        ]}
        title={navCollapsed ? children : undefined}
        aria-label={navCollapsed ? children : undefined}
        onPointerDown={handlePointerDown}
        onClick={() => {
          onActivate?.()
          navigate(to)
        }}
      >
        {(effectiveMenuIcon === 'monochrome' || !effectiveMenuIcon) && (
          <ListItemIcon
            sx={{
              color: 'text.primary',
              minWidth: 28,
              marginLeft: '2px',
              cursor: draggable ? 'grab' : 'inherit',
              '& .MuiSvgIcon-root': { fontSize: 18 },
            }}
          >
            <Badge
              color="error"
              badgeContent={badgeCount > 99 ? '99+' : badgeCount}
              invisible={!badgeCount}
              max={99}
              overlap="circular"
              sx={{
                '& .MuiBadge-badge': {
                  fontSize: 10,
                  height: 16,
                  minWidth: 16,
                  padding: '0 4px',
                },
              }}
            >
              <Box component="span" sx={{ display: 'inline-flex' }}>
                {icon[0]}
              </Box>
            </Badge>
          </ListItemIcon>
        )}
        {effectiveMenuIcon === 'colorful' && (
          <ListItemIcon
            sx={{
              minWidth: 28,
              cursor: draggable ? 'grab' : 'inherit',
              '& .MuiSvgIcon-root, & svg': { width: 18, height: 18 },
            }}
          >
            <Badge
              color="error"
              badgeContent={badgeCount > 99 ? '99+' : badgeCount}
              invisible={!badgeCount}
              max={99}
              overlap="circular"
              sx={{
                '& .MuiBadge-badge': {
                  fontSize: 10,
                  height: 16,
                  minWidth: 16,
                  padding: '0 4px',
                },
              }}
            >
              <Box component="span" sx={{ display: 'inline-flex' }}>
                {icon[1]}
              </Box>
            </Badge>
          </ListItemIcon>
        )}
        <ListItemText
          sx={{
            textAlign: 'center',
            marginLeft: effectiveMenuIcon === 'disable' ? 0 : '-20px',
          }}
          primary={
            effectiveMenuIcon === 'disable' && badgeCount > 0 ? (
              <Badge
                color="error"
                badgeContent={badgeCount > 99 ? '99+' : badgeCount}
                max={99}
                sx={{
                  '& .MuiBadge-badge': {
                    fontSize: 10,
                    height: 16,
                    minWidth: 16,
                    top: 2,
                    right: -10,
                  },
                }}
              >
                <Box component="span">{children}</Box>
              </Badge>
            ) : (
              children
            )
          }
        />
      </ListItemButton>
    </ListItem>
  )
}
