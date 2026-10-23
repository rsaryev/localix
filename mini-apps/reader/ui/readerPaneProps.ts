import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'

import type { ReaderSource } from '../shared/contracts'
import type { ReaderTextTarget } from './model'

/** What the workspace hands one reading pane. */
export interface ReaderPaneProps {
  sessionId: string
  path?: string
  mediaId?: string
  name?: string
  initialChapter?: number
  initialHighlight?: ReaderTextTarget
  visible: boolean
  onBack?: () => void
  onOpenBook: (source: ReaderSource) => void
  compact?: boolean
  keyboardActive?: boolean
  parallelActive?: boolean
  onParallelRead?: () => void
  onClosePane?: () => void
  onActivate?: () => void
  onChapterChange?: (chapter: number) => void
  /** The source turned out to be unreadable — the owner drops it so a reopened
   *  Reader lands on the library instead of restoring the failure. */
  onUnreadable?: (source: ReaderSource) => void
  publishMessageContext?: PublishMessageContext
}
