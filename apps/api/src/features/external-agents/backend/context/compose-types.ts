import type { TranscriptEvent } from '../../shared/contracts'

export interface ComposeSection {
  readonly key: string
  /** The adapter's byte cap cut the source, so its positions are not the session's. */
  readonly sourceTruncated?: boolean
  /** Which end the read came from — the one end-claim a truncated slice CAN support. */
  readonly readFrom?: 'head' | 'tail'
  readonly provider: string
  readonly title: string
  readonly cwd?: string
  readonly sourcePath: string
  readonly events: readonly TranscriptEvent[]
  readonly renderedChars: number
  readonly withheldEvents: number
  readonly totalEvents: number
  readonly earliest?: number
  readonly latest?: number
}

export interface ComposeResult {
  readonly sections: readonly ComposeSection[]
  readonly text: string
  readonly totalWithheldEvents: number
  readonly budgetChars: number
  readonly usedChars: number
  /** Human-readable notes about ordering and budget. Always surfaced; never silently applied. */
  readonly notes: readonly string[]
}
