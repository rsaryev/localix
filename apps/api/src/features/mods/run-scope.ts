import type { ModelStepHook } from '@localixai/agent'
import type { AgentTool } from '@localixai/agent/agents'
import { offerAgents, wrapDelegate, type DirectoryAgent } from './agent-events'
import type { RunSurface } from './api/run-api'
import type { ModScene } from './contracts'
import { skillPromptIn, wrapSkillTool } from './conversation-events'
import { agentOf, type ModEventScope } from './event-scope'
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
import { modTools, wrapInToolCall } from './tool-call'
import { toolCheckPort, type ModVerdict } from './tool-check'
import { describeTools, type DescribedTools, type ToolPlacement } from './tool-describe'
import { modelStepHook } from './turn-step'

/**
 * The mods of one conversation turn: the events a run fires — `prompt.submit`, `turn.start`,
 * `turn.step`, `turn.complete`, `tool.call`, `tool.check`, `tool.describe`, the prompt's
 * `prompt.section`, `prompt.compose`, `prompt.context`, `prompt.attachment` and
 * `attribution.text`, `agent.offer`, `agent.spawn`, `session.append` and `session.compact` — sent
 * to the instances of the mods enabled there that run in the conversation's project, started for
 * it when they are not running yet. Every method is cheap and inert when no such mod hooks the
 * event.
 */

export type PromptOutcome =
  | { dropped: true; reason: string }
  | { dropped: false; text: string; context: readonly string[] }

export interface ModRunScope {
  readonly active: boolean
  /**
   * Whether the run's calls meet the permission gate inside `tool.call`, after the `PreToolUse`
   * hooks, as in Claude Code: true when a mod hears `tool.call` or `tool.check`.
   */
  readonly gateInChain: boolean
  /** `prompt.submit`: the prompt as the model will read it, notes for it, or a drop. */
  submit(text: string, turnId: string): Promise<PromptOutcome>
  turnStart(text: string, turnId: string): Promise<void>
  /** `turn.complete`: a text a mod shows beneath the answer, when it gives one of its own. */
  turnComplete(input: {
    answer: string
    turnId: string
    durationMs: number
    reason: 'answer' | 'aborted' | 'error'
  }): Promise<string | undefined>
  wrapTools(tools: readonly AgentTool[]): AgentTool[]
  /** `skill.prompt` for a skill preloaded into the run: the text the prompt holds for it. */
  skillPrompt?(skill: string, text: string): Promise<string>
  /** The tools the enabled mods registered. */
  tools(): AgentTool[]
  /** `tool.describe`: each tool's description, and the tools a mod moved behind the activator. */
  describeTools(tools: readonly AgentTool[], placement: ToolPlacement): Promise<DescribedTools>
  /** `prompt.section`, `attribution.text`, `prompt.compose`: the system prompt, when mods take part. */
  composePrompt(facts: ComposeFacts): Promise<string | undefined>
  /** `prompt.context` and `prompt.attachment`: the runtime context the turn carries. */
  runtimeContext(sections: readonly ContextSection[]): Promise<ContextSection[]>
  /** `agent.offer`: the directory's agents, or the plugins' agent types, the model is offered. */
  offerAgents<T extends DirectoryAgent>(agents: readonly T[]): Promise<T[]>
  /** `tool.check` for the permission gate: a review of its verdicts, and its verdict lent. */
  toolCheck(): ModToolCheck | undefined
  /** `turn.step` around each model request of the turn; undefined when no mod hears it. */
  modelStep(turnId: string): ModelStepHook | undefined
  /** `session.compact`: whether the checkpoint due now is kept, skipped, or one a mod asked for. */
  compaction(due: string | undefined): Promise<CompactionVerdict>
  /** `session.append` for the turn's answer: the payload as it is stored. */
  storeResponse<P extends { content?: unknown; items?: readonly unknown[] }>(payload: P): Promise<P>
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
  run: { model: string; agentId?: string } = { model: '' },
): Promise<ModRunScope> {
  const plugins = await host.instancesFor(scene, enabled)
  const active = plugins.size > 0
  const scope: ModEventScope = { host, scene, plugins, ...agentOf(run) }
  // Between turns, the conversation's events go to the mods this turn runs with.
  if (active) host.conversations.joined(scene, plugins)
  // What the turn lends `$.tool`, `$.mcp` and `$.tool.check` while it runs.
  const surface: RunSurface = { tools: [] }
  let directory: readonly DirectoryAgent[] = []
  return {
    active,
    gateInChain: active && (host.hears('tool.call', plugins) || host.hears('tool.check', plugins)),
    async submit(text, turnId) {
      // Rows a mod appended since the last prompt reach the model with this one.
      const appended = scene.sessionId ? host.composer.takeNotes(scene.sessionId) : []
      if (!active || !host.hears('prompt.submit', plugins))
        return { dropped: false, text, context: appended }
      const input = { text, turnId, wait: false, origin: { kind: 'composer' } }
      const answer = (await host.dispatch(
        'prompt.submit',
        input,
        (e) => ({ text: (e as typeof input).text, context: (e as { context?: unknown }).context }),
        scene,
        plugins,
      )) as { drop?: unknown; text?: unknown; context?: unknown } | undefined
      if (typeof answer?.drop === 'string') return { dropped: true, reason: answer.drop }
      return {
        dropped: false,
        text: typeof answer?.text === 'string' ? answer.text : text,
        context: [...appended, ...strings(answer?.context)],
      }
    },
    async turnStart(text, turnId) {
      if (active && host.hears('turn.start', plugins))
        await host.dispatch(
          'turn.start',
          { text, turnId, ...agentOf(scope) },
          () => ({ turnId }),
          scene,
          plugins,
        )
    },
    async turnComplete(input) {
      if (scene.sessionId) host.detachRun(scene.sessionId)
      await host.measure(scene, plugins).catch(() => {})
      if (!active || !host.hears('turn.complete', plugins)) return undefined
      const answer = (await host.dispatch(
        'turn.complete',
        { ...input, isAborted: input.reason === 'aborted', ...agentOf(scope) },
        () => ({ text: input.answer }),
        scene,
        plugins,
      )) as { text?: unknown } | undefined
      const text = typeof answer?.text === 'string' ? answer.text.trim() : ''
      return text && text !== input.answer.trim() ? text : undefined
    },
    wrapTools(tools) {
      if (!active) return [...tools]
      // The turn's tools, before the mods wrap them: `$.tool.call` fires `tool.call` itself.
      surface.tools = [...tools, ...modTools(scope)]
      if (scene.sessionId) host.attachRun(scene.sessionId, surface)
      // `agent.spawn` inside `tool.call`, as the Agent tool runs inside its call; a result is
      // stored (`session.append`) once the call is done.
      const spawning = wrapDelegate(tools, scope, {
        parentModel: run.model,
        directory: () => directory,
      })
      return wrapToolResults(wrapInToolCall(wrapSkillTool(spawning, scope), scope), scope)
    },
    skillPrompt: async (skill, text) => (active ? skillPromptIn(scope, skill, text) : text),
    tools: () => (active ? modTools(scope) : []),
    describeTools: (tools, placement) =>
      active
        ? describeTools(scope, tools, placement)
        : Promise.resolve({ tools: [...tools], placed: new Map() }),
    composePrompt: async (facts) => (active ? composeSystemPrompt(scope, facts) : undefined),
    runtimeContext: async (sections) => (active ? runtimeContext(scope, sections) : [...sections]),
    async offerAgents(agents) {
      // The registry's agents and the plugins' subagent types are offered apart; both are listed.
      const names = new Set(agents.map((agent) => agent.name))
      directory = [...directory.filter((agent) => !names.has(agent.name)), ...agents]
      return active ? offerAgents(scope, agents) : [...agents]
    },
    toolCheck: () =>
      active
        ? toolCheckPort(
            scope,
            () => surface.tools,
            (verdict) => void (surface.verdict = verdict),
          )
        : undefined,
    modelStep: (turnId) => (active ? modelStepHook(scope, turnId) : undefined),
    compaction: async (due) => (active ? reviewCompaction(scope, due) : 'keep'),
    async storeResponse(payload) {
      if (!active || typeof payload.content !== 'string') return payload
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
