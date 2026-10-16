import type { AttentionItem } from '@localixai/api/client'
import type { UiSession } from '@/shared/api/contracts'

/**
 * What every kind's dialog body is handed. The dialog shell (`AttentionDialog.tsx`) resolves the
 * waiting chat and owns the two moves every kind shares — go to the chat, and settle the item in
 * this window — so a body only renders its own question and its own answers.
 */
export interface AttentionBodyProps {
  item: AttentionItem
  /** The waiting chat's row, from the full session set (it may be in another project). */
  session: UiSession | undefined
  /** Its title, or a neutral stand-in while the row is not loaded. */
  sessionTitle: string
  /** Go to the waiting chat; also settles the item here. */
  openChat: () => void
  /** Drop the item from this window's dialog now — the server's next roster agrees shortly. */
  settle: () => void
}
