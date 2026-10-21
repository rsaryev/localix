import {
  RefreshCw,
  SquareTerminal,
  Eye,
  User,
  Webhook,
  Radio,
  Bot,
  SmilePlus,
  Puzzle,
  MessageSquareShare,
  ClipboardPen,
  ClipboardCheck,
  Play,
  type LucideIcon,
} from 'lucide-react'
import { WAKE_SOURCE_LABEL } from '@localixai/api/wake-provenance'
import type { WakeSource } from '@/shared/api/contracts'

/**
 * Presentation meta for a queued turn's provenance (`WakeSource`) — the ICON per
 * source, REUSING the same lucide glyphs the sibling composer strips already use
 * (loop=RefreshCw, bg-job=SquareTerminal, bg-monitor=Eye) so the queue
 * chip reads in the same visual language rather than inventing a new one. The icon
 * is genuinely a client fact — a rendering choice each surface makes for itself;
 * the LABEL is one fact owned by the `@localixai/api/wake-provenance` leaf, so we
 * pair each glyph with its shared title-case label rather than re-spelling it.
 */
const WAKE_SOURCE_ICON: Record<WakeSource, LucideIcon> = {
  loop: RefreshCw,
  'bg-job': SquareTerminal,
  'bg-monitor': Eye,
  'user-busy': User,
  'user-steer': User,
  hook: Webhook,
  external: Radio,
  // The glyph the rail and the settings already use for a plugin.
  plugin: Puzzle,
  subagent: Bot,
  // The person marked a message and that asked for a turn — the one wake that comes from a
  // gesture rather than from typing, so it gets the gesture's own glyph.
  reaction: SmilePlus,
  // The agent that assigned this child its task, speaking down the same edge a report goes up.
  delegator: MessageSquareShare,
  // The person decided on a plan: comments sent back for a revision, or the go-ahead.
  'plan-review': ClipboardPen,
  'plan-approved': ClipboardCheck,
  // The person asked the agent to continue work it had stopped on (`features/resume`).
  resume: Play,
}

export const WAKE_SOURCE_META: Record<WakeSource, { Icon: LucideIcon; label: string }> =
  Object.fromEntries(
    (Object.keys(WAKE_SOURCE_ICON) as WakeSource[]).map((source) => [
      source,
      { Icon: WAKE_SOURCE_ICON[source], label: WAKE_SOURCE_LABEL[source] },
    ]),
  ) as Record<WakeSource, { Icon: LucideIcon; label: string }>
