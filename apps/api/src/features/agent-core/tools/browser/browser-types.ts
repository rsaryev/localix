// The shapes the `browser` tool and its relay share: what the tool card reads, what the host
// injects, and what one finished action returns. Kept apart so the relay (browser-relay.ts) and
// the tool body (browser.ts) can both use them without importing each other.

import type { AgentToolResult } from '@localixai/agent/agents'
import type {
  PreviewAction,
  PreviewCommand,
  PreviewConsoleEntry,
  PreviewSendOutcome,
  PreviewSnapshot,
} from '../preview/preview-control'
import type { OpenPreviewCoreInput, OpenPreviewCoreResult } from '../preview/open-preview'
import type { GoalDeps } from './browser-goal'
import type { BrowserSecrets } from './browser-secrets'

/** Uniform UI detail shape across all actions (read by the tool card). The `open`
 *  and `close` actions are tool-only (never relayed to the probe), so they widen the
 *  relay-facing `PreviewAction` here without leaking into the probe protocol. */
export interface BrowserDetails {
  errorCode?: string
  error?: string
  previewId?: string
  ready?: boolean
  viewport?: { width: number; height: number }
  action: PreviewAction | 'open' | 'close' | 'goal'
  snapshot?: PreviewSnapshot
  console?: PreviewConsoleEntry[]
  rect?: { x: number; y: number; width: number; height: number } | null
  target?: string
  diff?: string
  value?: string
  /** A running `goal`: the trace so far, streamed after each step. */
  steps?: string[]
}

export interface BrowserToolDeps {
  /** Relay one command to the open preview, bound to this user + session.
   *  `opts.timeoutMs` bounds a BEST-EFFORT relay (the snapshot folded into an `open`
   *  result) so it doesn't freeze for the full default window when no probe is
   *  attached (an unattended/headless run). */
  send(command: PreviewCommand, opts?: { timeoutMs?: number }): Promise<PreviewSendOutcome>
  /** Open (or refresh) a preview — delegates to the shared `openPreviewCore`. */
  openPreview(input: OpenPreviewCoreInput): Promise<OpenPreviewCoreResult>
  /**
   * Tell the UI to close these tabs. Tool-only — never relayed to the probe (a plain function
   * dep; agent-core stays agnostic of the stream registry behind it).
   */
  closePreview(previewIds: string[]): void
  /** The decision model the `goal` action asks, bound to this run; absent without one. */
  decide?: GoalDeps['decide']
  /** The vault for a `${secret:KEY}` in a typed value (see browser-secrets.ts); absent without one. */
  secrets?: BrowserSecrets
}

export type ToolResult = AgentToolResult<BrowserDetails>

/** A finished action, plus whether the probe reported the page reloaded under us. */
export interface ActionOutcome {
  result: ToolResult
  reloaded?: boolean
}
