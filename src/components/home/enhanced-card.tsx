import { Box, Typography, alpha, useTheme } from '@mui/material'
import React, { forwardRef, ReactNode } from 'react'

// 自定义卡片组件接口
interface EnhancedCardProps {
  title?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  iconColor?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success'
  minHeight?: number | string
  noContentPadding?: boolean
  /** 紧凑模式：缩小图标、标题与内边距，适配首页信息密度 */
  dense?: boolean
  /** 隐藏标题行，只保留卡片容器与内容 */
  hideHeader?: boolean
}

// 自定义卡片组件
export const EnhancedCard = forwardRef<HTMLElement, EnhancedCardProps>(
  (
    {
      title,
      icon,
      action,
      children,
      iconColor = 'primary',
      minHeight,
      noContentPadding = false,
      dense = false,
      hideHeader = false,
    },
    ref,
  ) => {
    const theme = useTheme()
    const isDark = theme.palette.mode === 'dark'

    // 统一的标题截断样式
    const titleTruncateStyle = {
      minWidth: 0,
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      display: 'block',
    }

    const iconBox = dense ? 28 : 38
    const headerPx = dense ? 1.25 : 2
    const headerPy = dense ? 0.65 : 1
    const contentP = dense ? 1.25 : 2
    const titleSize = dense ? 14 : 18
    const iconMr = dense ? 1 : 1.5

    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: dense ? 1.5 : 2,
          backgroundColor: isDark ? '#282a36' : '#ffffff',
        }}
        ref={ref}
      >
        {!hideHeader && (
          <Box
            sx={{
              px: headerPx,
              py: headerPy,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                minWidth: 0,
                flex: 1,
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: dense ? 1 : 1.5,
                  width: iconBox,
                  height: iconBox,
                  mr: iconMr,
                  flexShrink: 0,
                  backgroundColor: alpha(theme.palette[iconColor].main, 0.12),
                  color: theme.palette[iconColor].main,
                  '& svg': dense ? { fontSize: 16 } : undefined,
                }}
              >
                {icon}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                {typeof title === 'string' ? (
                  <Typography
                    variant="h6"
                    sx={{
                      ...titleTruncateStyle,
                      fontWeight: 'medium',
                      fontSize: titleSize,
                      lineHeight: 1.25,
                    }}
                    title={title}
                  >
                    {title}
                  </Typography>
                ) : (
                  <Box sx={titleTruncateStyle}>{title}</Box>
                )}
              </Box>
            </Box>
            {action && (
              <Box sx={{ ml: dense ? 1 : 2, flexShrink: 0 }}>{action}</Box>
            )}
          </Box>
        )}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            p: noContentPadding ? 0 : contentP,
            ...(minHeight && { minHeight }),
          }}
        >
          {children}
        </Box>
      </Box>
    )
  },
)
