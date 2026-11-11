import type { ModelStepHook } from '@localixai/agent'
import type { AgentTool } from '@localixai/agent/agents'
import { clampReason, promptDroppedText } from '../plugins/kit'
import { offerAgents, wrapAgent, type DirectoryAgent } from './agent-events'
import type { RunSurface } from './session/run-tools'
import type { ModelUsage, ModScene } from './contracts'
import { skillPromptIn, wrapSkillTool } from './conversation-events'
import { agentOf, fireIn, hearsIn, type ModEventScope } from './event-scope'
import type { ModsHost } from './host'
import { runtimeContext, type ContextSection } from './run-context'
import { composeSystemPrompt, type ComposeFacts } from './run-prompt'
import {
  appendResponse,
  reviewCompaction,
  withResponse,
  wrapToolResults,
  type CompactionVerdict,
} from './session-events'
import { modTools, wrapInToolCall, type ModTool } from './tool-call'
import { toolCheckPort, type ModVerdict, type ToolCheckRun } from './tool-check'
import { describeTools, type DescribedTools, type ToolPlacement } from './tool-describe'
import { modelStepHook } from './turn-step'

/**
 * The mods of one conversation turn: the events a run fires — `prompt.submit`, `turn.start`,
 * `turn.step`, `turn.complete`, `tool.call`, `tool.check`, `tool.describe`, the prompt's
 * `prompt.section`, `prompt.compose`, `prompt.context`, `prompt.attachment` and
 * `attribution.text`, `agent.offer`, `agent.spawn`, `session.append` and `session.compact` — sent
 * through the chain of the conversation's kit host (`session/session-host.ts`), loaded with the
 * mods enabled there when it is not yet. A delegated child's run goes to its parent's host, as a
 * Claude Code subagent runs in its session's mods. Every method is cheap and inert when no such
 * mod hooks the event.
 */

export type PromptOutcome =
  /** `notice` is the line the person reads (Claude Code's, the kit's `promptDroppedText`). */
  | { dropped: true; reason: string; notice: string }
  | { dropped: false; text: string; context: readonly string[] }

export interface ModRunScope {
  readonly active: boolean
  /**
   * Whether the run's calls meet the permission gate inside `tool.call`, after the `PreToolUse`
   * hooks, as in Claude Code: true whenever mods run, so a call a mod makes through the tools
   * the turn lends (`$.tool.call`, `$.mcp.call`, `$.agent.spawn`) meets the gate too.
   */
  readonly gateInChain: boolean
  /** `prompt.submit`: the prompt as the model will read it, notes for it, or a drop. */
  submit(text: string, turnId: string): Promise<PromptOutcome>
  turnStart(text: string, turnId: string): Promise<void>
  /** `turn.complete`: a text a mod shows beneath the answer, when it gives one of its own. */
  turnComplete(input: TurnEnd & { answer: string; turnId: string }): Promise<string | undefined>
  /**
   * `turn.complete` for a turn the run's failure path ended (an error, a stop), unless its end
   * was heard already: what the turn started with, no answer.
   */
  turnFailed(input: Omit<TurnEnd, 'durationMs'> & { durationMs?: number }): Promise<void>
  wrapTools(tools: readonly AgentTool[]): AgentTool[]
  /** `skill.prompt` for a skill preloaded into the run: the text the prompt holds for it. */
  skillPrompt?(skill: string, text: string): Promise<string>
  /** The tools the enabled mods registered. */
  tools(): ModTool[]
  /** `tool.describe`: each tool's description, and the tools a mod moved behind the activator. */
  describeTools(tools: readonly AgentTool[], placement: ToolPlacement): Promise<DescribedTools>
  /** `prompt.section`, `attribution.text`, `prompt.compose`: the system prompt, when mods take part. */
  composePrompt(facts: ComposeFacts): Promise<string | undefined>
  /** `prompt.context` and `prompt.attachment`: the runtime context the turn carries. */
  runtimeContext(sections: readonly ContextSection[]): Promise<ContextSection[]>
  /** `agent.offer`: the directory's agents, or the plugins' agent types, the model is offered. */
  offerAgents<T extends DirectoryAgent>(agents: readonly T[]): Promise<T[]>
  /** `tool.check` for the permission gate: a review of its verdicts, and its verdict lent. */
  toolCheck(facts?: ToolCheckRun): ModToolCheck | undefined
  /** `turn.step` around each model request of the turn; undefined when no mod hears it. */
  modelStep(turnId: string): ModelStepHook | undefined
  /** `session.compact`: whether the checkpoint due now is kept, skipped, or one a mod asked for. */
  compaction(due: string | undefined): Promise<CompactionVerdict>
  /** `session.append` for the turn's answer: the payload as it is stored. */
  storeResponse<P extends { content?: unknown; items?: readonly unknown[] }>(payload: P): Promise<P>
}

/** How a turn ended, as `turn.complete` says it. */
export interface TurnEnd {
  durationMs: number
  reason: 'answer' | 'aborted' | 'error'
  /** The turn's token counts and the model that answered last; absent when none counted. */
  usage?: ModelUsage & { model: string }
}

export interface ModToolCheck {
  review?: (
    call: { toolCallId: string; toolName: string; input: unknown },
    verdict: ModVerdict,
  ) => Promise<ModVerdict>
  lend(verdict: (toolName: string, input: unknown) => ModVerdict): void
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

export async function createModRunScope(
  host: ModsHost,
  scene: ModScene,
  enabled: ReadonlySet<string>,
  /** The model the run's requests name, for the events that carry it. */
  run: { model: string; agentId?: string; parentSessionId?: string } = { model: '' },
): Promise<ModRunScope> {
  // A delegated child's run reaches its parent conversation's mods.
  const hostScene = run.parentSessionId ? { ...scene, sessionId: run.parentSessionId } : scene
  // The mods load a moment after start or a plugin change: the turn runs with them, not with none.
  await host.settled()
  const kit = await host.hostFor(hostScene, enabled)
  const active = kit !== undefined
  const scope: ModEventScope | undefined = kit ? { host, kit, scene, ...agentOf(run) } : undefined
  /** The scope when a loaded mod hears `event`. */
  const hearing = (event: string) => (scope && hearsIn(scope, event) ? scope : undefined)
  // Between turns, the conversation's events go to the mods this turn runs with.
  if (active) host.conversations.joined(hostScene, enabled)
  // What the turn lends `$.tool`, `$.mcp` and `$.tool.check` while it runs.
  const surface: RunSurface = { tools: [] }
  let directory: readonly DirectoryAgent[] = []
  /** The turn started and not yet heard to end: `turnFailed` ends it. */
  let open: { turnId: string; at: number } | undefined
  async function complete(input: TurnEnd & { answer: string; turnId: string }) {
    open = undefined
    if (scene.sessionId) host.band.runs.detach(scene.sessionId)
    if (scope) await host.measure(scope).catch(() => {})
    const on = hearing('turn.complete')
    if (!on) return undefined
    const answer = (await fireIn(
      on,
      'turn.complete',
      { ...input, isAborted: input.reason === 'aborted', ...agentOf(on) },
      () => ({ text: input.answer, ...(input.usage ? { usage: input.usage } : {}) }),
    )) as { text?: unknown } | undefined
    const text = typeof answer?.text === 'string' ? answer.text.trim() : ''
    return text && text !== input.answer.trim() ? text : undefined
  }
  return {
    active,
    gateInChain: active,
    async submit(text, turnId) {
      // Rows a mod appended since the last prompt reach the model with this one.
      const appended = scene.sessionId ? host.composer.takeNotes(scene.sessionId) : []
      // A prompt a mod submitted met its hooks as that call, with the plugin as its origin. Taken
      // on every submit, whoever listens, so the entry cannot outlive its turn.
      const heard = scene.sessionId ? host.composer.takeSubmitted(scene.sessionId, text) : false
      const on = hearing('prompt.submit')
      if (!on || heard) return { dropped: false, text, context: appended }
      // The turn's id is `turn.start`'s to carry, as in Claude Code.
      void turnId
      const input = { text, wait: false, origin: { kind: 'composer' } }
      const answer = (await fireIn(on, 'prompt.submit', input, (e) => {
        const { context } = e as { context?: unknown }
        return {
          text: (e as typeof input).text,
          ...(Array.isArray(context) ? { context } : {}),
          origin: (e as typeof input).origin,
        }
      })) as { drop?: unknown; text?: unknown; context?: unknown } | undefined
      if (typeof answer?.drop === 'string') {
        const reason = clampReason(answer.drop)
        return { dropped: true, reason, notice: promptDroppedText(reason) }
      }
      return {
        dropped: false,
        text: typeof answer?.text === 'string' ? answer.text : text,
        context: [...appended, ...strings(answer?.context)],
      }
    },
    async turnStart(text, turnId) {
      open = { turnId, at: Date.now() }
      const on = hearing('turn.start')
      if (on) await fireIn(on, 'turn.start', { text, turnId, ...agentOf(on) }, () => ({ turnId }))
    },
    turnComplete: complete,
    async turnFailed(input) {
      if (open === undefined) return
      const durationMs = input.durationMs ?? Math.max(0, Date.now() - open.at)
      await complete({ ...input, durationMs, answer: '', turnId: open.turnId })
    },
    wrapTools(tools) {
      if (!scope) return [...tools]
      // The turn's tools, before the mods wrap them: `$.tool.call` fires `tool.call` itself.
      surface.tools = [...tools, ...modTools(scope)]
      if (scene.sessionId) host.band.runs.attach(scene.sessionId, surface)
      // `agent.spawn` inside `tool.call`, as the Agent tool runs inside its call; a result is
      // stored (`session.append`) once the call is done.
      const spawning = wrapAgent(tools, scope, {
        parentModel: run.model,
        directory: () => directory,
      })
      return wrapToolResults(wrapInToolCall(wrapSkillTool(spawning, scope), scope), scope)
    },
    skillPrompt: async (skill, text) => (scope ? skillPromptIn(scope, skill, text) : text),
    tools: () => (scope ? modTools(scope) : []),
    describeTools: (tools, placement) =>
      scope
        ? describeTools(scope, tools, placement)
        : Promise.resolve({ tools: [...tools], placed: new Map() }),
    composePrompt: async (facts) => (scope ? composeSystemPrompt(scope, facts) : undefined),
    runtimeContext: async (sections) => (scope ? runtimeContext(scope, sections) : [...sections]),
    async offerAgents(agents) {
      // The registry's agents and the plugins' subagent types are offered apart; both are listed.
      const names = new Set(agents.map((agent) => agent.name))
      directory = [...directory.filter((agent) => !names.has(agent.name)), ...agents]
      return scope ? offerAgents(scope, agents) : [...agents]
    },
    toolCheck: (facts) =>
      scope
        ? toolCheckPort(
            scope,
            () => surface.tools,
            (verdict) => void (surface.verdict = verdict),
            facts,
          )
        : undefined,
    modelStep: (turnId) => (scope ? modelStepHook(scope, turnId) : undefined),
    compaction: async (due) => (scope ? reviewCompaction(scope, due) : 'keep'),
    async storeResponse(payload) {
      if (!scope || typeof payload.content !== 'string') return payload
      const text = await appendResponse(scope, payload.content, run.model)
      return text === payload.content ? payload : withResponse(payload, text)
    },
  }
}

/** The scope of a run with no mods: what a host without a mods host gets. */
export const NO_MODS: ModRunScope = {
  active: false,
  gateInChain: false,
  submit: async (text) => ({ dropped: false, text, context: [] }),
  turnStart: async () => {},
  turnComplete: async () => undefined,
  turnFailed: async () => {},
  wrapTools: (tools) => [...tools],
  tools: () => [],
  describeTools: async (tools) => ({ tools: [...tools], placed: new Map() }),
  composePrompt: async () => undefined,
  runtimeContext: async (sections) => [...sections],
  offerAgents: async (agents) => [...agents],
  toolCheck: () => undefined,
  modelStep: () => undefined,
  compaction: async () => 'keep',
  storeResponse: async (payload) => payload,
}

/** Every tool call of the run through the enabled mods' `tool.call` hooks. */
export function wrapToolsWithMods(tools: readonly AgentTool[], mods: ModRunScope): AgentTool[] {
  return mods.wrapTools(tools)
}
