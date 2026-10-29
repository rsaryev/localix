import type { ComponentType } from 'react'
import type { ResolvedTheme } from '@/shared/theme/useTheme'

export interface ChatSurfaceSlotProps {
  sessionId: string | null
  /** The one focused surface; it drives the singleton side effects. */
  isFocused: boolean
  /** On screen: its tab is the one its group shows, focused or not. */
  isVisible: boolean
  resolvedTheme: ResolvedTheme
}

/**
 * The surface a `chat` tab renders. The chat workspace widget owns it and the app installs it,
 * so the editor grid lays out chat tabs without importing another widget.
 */
let installed: ComponentType<ChatSurfaceSlotProps> | null = null

export function registerChatSurface(surface: ComponentType<ChatSurfaceSlotProps>): () => void {
  installed = surface
  return () => {
    if (installed === surface) installed = null
  }
}

/** The installed chat surface, or null in a window that renders no chats. */
export function chatSurface(): ComponentType<ChatSurfaceSlotProps> | null {
  return installed
}
