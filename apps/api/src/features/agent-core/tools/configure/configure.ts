import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { defineAgentTool, type AgentToolResult, type CallClass } from '@localixai/agent/agents'
import type { ConfigChangeRequest, ConfigChangeResponse } from '@localixai/plugin-sdk/backend'
import { TOOL } from '../../tool-names'
import { errorMessage } from '../../../../lib/errors'
import {
  HITL_DECISION_MS,
  isHitlTimeout,
  unansweredError,
  unansweredRefusal,
} from '../hitl/decision-deadline'
import type { ConfigureToolOptions, InspectTarget, ProposalCard } from './configure-contracts'

export type { ConfigureHost, ConfigureToolOptions, ProposalCard } from './configure-contracts'

/**
 * `configure` — the agent's window onto its own configuration, and its one way to change it.
 *
 * `inspect` answers "why do I not have X" in the ledger's words (`tool-ledger.ts`); `propose`
 * raises a `config_change` human-in-the-loop request and, ONLY after the user's click, hands
 * the approved change to the host to apply. The tool itself writes nothing. It is the
 * configuration counterpart of a permission gate: the agent may ask, the human decides, the
 * decision is recorded with provenance and is reversible in Settings.
 *
 * Silence is a decline. `ask` auto-selects a recommended option on timeout because leaving a
 * question unanswered still lets the run continue; a configuration change that applies
 * itself because nobody was looking is the opposite of the trust boundary this tool exists
 * to keep.
 */
export const CONFIG_CHANGE_AUTO_DECLINE_MS = HITL_DECISION_MS

/** Bound on the agent's own justification: a card, not an essay. */
const REASON_MAX_CHARS = 400

/**
 * One flat object rather than a union by `kind`: the union rendered four JSON objects that
 * differed only in the literal, for a field whose one rule (`name` unless summary) is checked
 * on read below.
 */
const targetSchema = z
  .object({
    kind: z.enum(['tool', 'agent', 'setting', 'summary']),
    name: z.string().min(1).optional(),
  })
  .strict()

/** The flat wire target as the host's union, or null when a named kind came without its name. */
function inspectTargetOf(target: z.infer<typeof targetSchema> | undefined): InspectTarget | null {
  if (!target || target.kind === 'summary') return { kind: 'summary' }
  return target.name ? { kind: target.kind, name: target.name } : null
}

function inputSchemaFor(changeSchema: z.ZodType<unknown>) {
  return z.object({
    action: z
      .enum(['inspect', 'propose'])
      .describe(
        'inspect (read-only): why something is unavailable or what it is set to. propose: ask the user to approve ONE change.',
      ),
    target: targetSchema
      .optional()
      .describe('inspect: omit for the whole picture; name is required unless kind is summary.'),
    change: changeSchema
      .optional()
      .describe('propose: the one change the task needs; `enabled` defaults to true.'),
    reason: z
      .string()
      .max(REASON_MAX_CHARS)
      .optional()
      .describe('propose: one sentence for the user on why it helps.'),
  })
}

type ConfigureInput = z.infer<ReturnType<typeof inputSchemaFor>>

export interface ConfigureToolDetails {
  request?: ConfigChangeRequest
  response?: ConfigChangeResponse
  outcome?: 'applied' | 'declined' | 'expired' | 'failed'
  reload?: ProposalCard['reload']
}

const declinedResult = (
  card: ProposalCard,
  why: string,
): AgentToolResult<ConfigureToolDetails> => ({
  content: `The user declined "${card.title}" (${why}). Do not propose it again in this conversation; continue with the tools you have or ask the user directly.`,
  isError: true,
})

/**
 * One `configure` call's class. `inspect` must stay `read` so a plan session can still ask
 * why a tool is missing. `propose` changes the agent's own configuration beyond this
 * conversation (`host`) and only after a person clicks, so an unattended session must refuse
 * it rather than park on a card nobody answers (`needsHuman`). Anything else is `external`.
 */
const CONFIGURE_INSPECT: CallClass = { effect: 'read' }
const CONFIGURE_PROPOSE: CallClass = { effect: 'host', needsHuman: true }

export function classifyConfigureCall(input: unknown): CallClass {
  const action = ((input ?? {}) as { action?: unknown }).action
  if (action === 'inspect') return CONFIGURE_INSPECT
  if (action === 'propose') return CONFIGURE_PROPOSE
  return { effect: 'external' }
}

export function createConfigureTool(options: ConfigureToolOptions) {
  const { host, sessionId, ledgerRef, declined } = options
  return defineAgentTool<ConfigureInput, ConfigureToolDetails>({
    name: TOOL.configure,
    label: 'Configure',
    activeVerb: 'Proposing a change',
    // The change kinds are the remedy registry's (`change` below), never spelled here: this
    // line once listed seven kinds after four of them were deleted, and the model proposed them.
    description:
      'Inspect why a tool or agent is unavailable, and PROPOSE switching a tool, plugin or MCP server on for this agent. ' +
      'Use it when "# Unavailable tools" or a tool error names a remedy. Nothing applies until the user approves; it usually takes effect next turn. Never propose the same change twice.',
    inputSchema: inputSchemaFor(host.changeSchema),
    executionMode: 'sequential',
    mutates: true,
    classify: classifyConfigureCall,
    async execute(toolCallId, input, signal, onUpdate, context) {
      if (input.action === 'inspect') {
        const target = inspectTargetOf(input.target)
        if (!target)
          return {
            content: `target.kind "${input.target?.kind}" needs target.name; pass {kind:"summary"} for the whole picture.`,
            isError: true,
          }
        return { content: await host.inspect(target, ledgerRef.current) }
      }
      if (input.change === undefined)
        return { content: 'action:"propose" requires `change`.', isError: true }
      if (!context?.humanInLoop || context.interactive === false) {
        return {
          content:
            'No human can approve a configuration change from this run. Report what is missing to the user instead.',
          isError: true,
        }
      }

      let card: ProposalCard
      try {
        card = await host.describe(input.change)
      } catch (error) {
        return { content: errorMessage(error), isError: true }
      }
      if (declined.has(card.key)) return declinedResult(card, 'earlier in this conversation')

      const proposalId = randomUUID()
      const now = Date.now()
      const request: ConfigChangeRequest = {
        id: toolCallId,
        kind: 'config_change',
        title: card.title,
        payload: {
          toolCallId,
          proposalId,
          remedyId: card.remedyId,
          title: card.title,
          detail: card.detail,
          ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
          diff: card.diff,
          agentId: card.agentId,
          reload: card.reload,
        },
        createdAt: now,
        expiresAt: now + CONFIG_CHANGE_AUTO_DECLINE_MS,
      }
      onUpdate?.({ request })

      // Two ways to end without an answer, and both mean NO. Silence cannot approve a
      // configuration change, and a dismissed card is a person closing it — the one signal
      // even clearer than a click. The deadline is the controller's now (`expiresAt`), not a
      // `Promise.race` of this tool's own: one clock, and the card counts down to it.
      type Outcome = { answered: ConfigChangeResponse } | { unanswered: 'expired' | 'dismissed' }
      const outcome = await context.humanInLoop
        .request<ConfigChangeRequest, ConfigChangeResponse>(request, signal)
        .then((response): Outcome => ({ answered: response }))
        .catch((error: unknown): Outcome => {
          // An ABORT is the run ending, not a decision: let it propagate.
          if (isHitlTimeout(error)) return { unanswered: 'expired' }
          if (error instanceof Error && error.name === 'HumanInLoopDismissedError')
            return { unanswered: 'dismissed' }
          throw error
        })

      if ('unanswered' in outcome) {
        const expired = outcome.unanswered === 'expired'
        declined.add(card.key)
        await host.recordDecision({
          proposalId,
          card,
          status: expired ? 'expired' : 'declined',
        })
        const content = expired
          ? unansweredRefusal(
              `"${card.title}" was not applied and nothing was changed. Do not propose it again in this conversation; continue with the tools you have.`,
            )
          : declinedResult(card, 'dismissed').content
        return {
          content,
          isError: true,
          ...(expired ? { error: unansweredError(content) } : {}),
          details: { request, outcome: expired ? 'expired' : 'declined' },
        }
      }
      const answer = outcome.answered
      const { approved } = answer.payload.answers
      // Nothing else is read off the answer. It used to carry a chosen scope, validated here
      // against the ones the card offered so a payload could not widen where a change lands;
      // there is one list now — the proposing agent's — so there is nothing to widen to.
      if (!approved) {
        declined.add(card.key)
        await host.recordDecision({ proposalId, card, status: 'declined' })
        return {
          ...declinedResult(card, 'declined'),
          details: { request, response: answer, outcome: 'declined' },
        }
      }
      await host.recordDecision({ proposalId, card, status: 'approved' })
      try {
        const applied = await host.apply({ change: input.change, proposalId })
        await host.recordDecision({ proposalId, card, status: 'applied' })
        return {
          content: `${applied.summary}\nTakes effect: ${card.reload}. Session ${sessionId} recorded the change as proposal ${proposalId}.`,
          details: { request, response: answer, outcome: 'applied', reload: card.reload },
        }
      } catch (error) {
        const message = errorMessage(error)
        await host.recordDecision({ proposalId, card, status: 'failed', error: message })
        return {
          content: `Approved, but applying failed: ${message}. Inspect the target again before proposing anew.`,
          isError: true,
          details: { request, response: answer, outcome: 'failed' },
        }
      }
    },
  })
}
