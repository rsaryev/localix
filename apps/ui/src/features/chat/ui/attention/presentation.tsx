/**
 * HOW EACH KIND OF "WAITING ON YOU" LOOKS — the UI half of the attention contract.
 *
 * `model/attention/policy.ts` decides what a kind may demand (priority, interrupting, the dock);
 * this decides how it is drawn: the sidebar row's badge and, for a kind that interrupts, the body
 * of the one cross-session dialog. Both are `Record<AttentionKind, …>`, so a kind added to the
 * server contract fails `tsc` here until it has a face, instead of rendering as nothing.
 *
 * A kind with no `Body` cannot be raised by the dialog even if its policy were flipped — the
 * dialog skips it — so "interrupts" and "has something to interrupt with" cannot disagree
 * silently.
 */
import type { ComponentType } from 'react'
import { AtSign, ClipboardList, Hand, MessageCircleQuestion, type LucideIcon } from 'lucide-react'
import type { AttentionItem, AttentionKind } from '@localixai/api/client'

import { HitlAttentionBody } from './HitlAttentionBody'
import { MentionAttentionBody } from './MentionAttentionBody'
import { PlanAttentionBody } from './PlanAttentionBody'
import type { AttentionBodyProps } from './types'

export interface AttentionBadge {
  icon: LucideIcon
  /** A status tone class: what state the row is in, not what a click does. */
  toneClass: 'text-status-warning' | 'text-status-info'
  /** Read by screen readers and the tooltip, for the row's items of this kind. */
  label: (items: readonly AttentionItem[]) => string
}

export interface AttentionPresentation {
  badge: AttentionBadge
  Body?: ComponentType<AttentionBodyProps>
}

const count = (items: readonly AttentionItem[], kind: AttentionKind) =>
  items.filter((item) => item.kind === kind).length

export const ATTENTION_PRESENTATION: Record<AttentionKind, AttentionPresentation> = {
  interaction: {
    badge: {
      icon: Hand,
      toneClass: 'text-status-warning',
      label: () => 'The agent is waiting for your input',
    },
    Body: HitlAttentionBody,
  },
  plan: {
    badge: {
      icon: ClipboardList,
      toneClass: 'text-status-info',
      label: () => 'A plan is waiting for your review',
    },
    Body: PlanAttentionBody,
  },
  mention: {
    badge: {
      icon: AtSign,
      toneClass: 'text-status-info',
      label: () => 'Someone in this conversation is asking you',
    },
    Body: MentionAttentionBody,
  },
  question: {
    badge: {
      icon: MessageCircleQuestion,
      toneClass: 'text-status-warning',
      label: (items) => {
        const open = count(items, 'question')
        return open === 1
          ? 'The agent asked you a question'
          : `The agent asked you ${open} questions`
      },
    },
  },
}
