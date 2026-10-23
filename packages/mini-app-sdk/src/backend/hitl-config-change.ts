/**
 * The `config_change` HITL contract — an agent PROPOSES a configuration change and a human
 * approves or declines it with one click. Pure types on the generic HITL bases, beside
 * `hitl-confirm.ts` so a mini app backend can raise the same request kind through the host's
 * controller instead of deep-importing the host.
 *
 * The payload is the CARD the user sees, already rendered by the host's remedy registry:
 * a title, a detail line, a diff of what changes, and the agent whose rules it lands in.
 * It is never redacted on its way to the client, exactly as with `ask`.
 *
 * The deadline is NOT here. It used to be `autoDeclineAt`, one of four spellings of the same
 * idea across four payloads; it lives on the request envelope (`expiresAt`) now, where the
 * HITL controller enforces it and every card reads it the same way.
 */
import type { HumanInLoopRequestBase, HumanInLoopResponseBase } from '@localixai/agent/agents'

/** How soon an applied change takes effect — the vocabulary `effective-config` already uses. */
export type ConfigReloadClass = 'immediate' | 'next-run' | 'new-session' | 'restart'

export interface ConfigChangePayload {
  toolCallId: string
  /** Stable id of the proposal row the host recorded; the answer resolves against it. */
  proposalId: string
  /** The remedy that will apply the change (`tool.enable`, `miniApp.enable`, …). */
  remedyId: string
  /** One line: what the agent wants to change. */
  title: string
  /** What the change DOES, written by the host's remedy. One line; the card clamps it. */
  detail: string
  /**
   * Why, in the agent's own words — kept separate from `detail` and attributed in the card.
   * They used to be joined into one string, which put an agent's sentence behind the card's
   * single-line clamp: the one part of the card a person actually has to read, elided.
   */
  reason?: string
  /** `- before` / `+ after` lines, or a short list of the fields that change. */
  diff: readonly string[]
  /**
   * Whose rules the change lands in — the agent that proposed it, and the only place it
   * could land.
   *
   * It used to be a stored SCOPE plus the list of scopes the user could pick between, and
   * the card rendered a selector. Rules belong to an agent now, so the list had exactly one
   * entry, the selector never drew, and the answer's chosen scope was never read. What is
   * left is the fact itself: this is the agent whose list changes.
   */
  agentId: string
  reload: ConfigReloadClass
}

export type ConfigChangeRequest = HumanInLoopRequestBase<'config_change', ConfigChangePayload>

export interface ConfigChangeResponsePayload {
  /** One bit, because there is one question: does this agent get what it asked for. */
  answers: { approved: boolean }
}

export type ConfigChangeResponse = HumanInLoopResponseBase<
  'config_change',
  ConfigChangeResponsePayload
>
