/** Client-only transcript notices, composed from independently bounded producer families. */
import { hookNoticeReducers } from './hook-notices'
import { terminalNoticeReducers } from './terminal-notices'
import type { StreamReducers } from './types'

export { noticePosition } from './notice-position'

export const noticeReducers: StreamReducers<
  'hook.notice' | 'terminal.waiting' | 'terminal.input' | 'terminal.finished'
> = {
  ...hookNoticeReducers,
  ...terminalNoticeReducers,
}
