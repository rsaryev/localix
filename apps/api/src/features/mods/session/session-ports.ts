import { randomUUID } from 'node:crypto'
import type { JsonObject, ModSessionPorts, SessionEntry } from '@rsaryev/llx-plugin/mods'
import { contextUsage, readClaudeSettings } from '../../plugins/kit'
import { mergeModSettingsLayers, settingsLayersForMods } from '../../plugins/kit/mods'
import { CLAUDE_CODE_BASE_VERSION } from '../../cc-settings/claude-code-version'
import { submittedContent, type ModelCompletion, type ModScene, type ModsPorts } from '../contracts'
import type { ModComposer } from '../composer'
import type { RunTools } from './run-tools'

/**
 * The session's side of the kit's mods API, as one Localix conversation gives it: its transcript,
 * its model route, its prompt box and its delegated children, all through the `ModsPorts` the
 * composition root binds. The kit reads each call's arguments, applies its limits and fires its
 * event; these ports only answer. What Localix has no engine for rejects, naming the call.
 */

export interface SessionPortsDeps {
  ports: ModsPorts
  /** The conversation the session's mods act in; `sessionId` absent for the workspace's. */
  scene: ModScene
  /** The prompt box's drafts and the rows mods appended (`composer.ts`). */
  composer: ModComposer
  /** The names of Localix's own commands, which a mod's command cannot take. */
  builtIns: () => readonly string[]
  /** Runs a command a mod asked for (`$.command.run`). */
  runCommand?: (command: { command: string; args: string }) => Promise<unknown>
  /** A short command's output, for `$.session.repo()` (git in the working directory). */
  run?: (argv: readonly string[], cwd: string) => Promise<{ exitCode: number; stdout: string }>
  /** What the conversation's running turn lends: its tools, its verdict, its `Agent` tool. */
  turn?: Pick<RunTools, 'tools' | 'spawn'>
  /** `$.session.compact`: a checkpoint the conversation takes as its next turn starts. */
  compact?: () => Promise<JsonObject>
  /** `$.prompt.compose`: the conversation's system prompt as its latest turn composed it. */
  compose?: () => Promise<readonly { id: string; text: string; scope: string }[]>
  /** The Claude Code settings `$.settings` reads, for the scene's folder. */
  settings?: () => ReturnType<typeof readClaudeSettings>
}

/** What `$.session.version()` names: Localix, the Claude Code release it runs mods as, and when it started. */
const VERSION = {
  version: 'localix',
  base: CLAUDE_CODE_BASE_VERSION,
  builtAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
}

const unsupported = (call: string) => () =>
  Promise.reject(new Error(`${call}: Localix does not support it`))

const NO_TURN: Pick<RunTools, 'tools' | 'spawn'> = {
  tools: { call: unsupported('$.tool.call'), check: unsupported('$.tool.check') },
  spawn: async () => ({ deny: 'Subagents start from a running turn of a conversation' }),
}

/** Claude Code's word for an agent that was stopped. */
const agentStatus = (status: string) => (status === 'stopped' ? 'killed' : status)

const CLASSIFY_SYSTEM = 'Answer with exactly one of the labels, as written, and nothing else.'

const joined = (blocks: readonly { text: string }[] | undefined) =>
  blocks?.map((block) => block.text).join('') ?? ''

/** A Localix completion as the kit's `CompleteResult`: an empty reply is `empty-reply`. */
function resultOf(reply: ModelCompletion) {
  if (!reply.isAnswered) return { isAnswered: false as const, reason: reply.reason }
  if (reply.text === '') return { isAnswered: false as const, reason: 'empty-reply' }
  return { isAnswered: true as const, text: reply.text, usage: { ...reply.usage } }
}

export function createSessionPorts(deps: SessionPortsDeps): ModSessionPorts {
  const { ports, scene, composer } = deps
  const { listCommands } = ports
  const turn = deps.turn ?? NO_TURN
  const settings = () =>
    deps.settings?.() ?? readClaudeSettings({ homeDir: ports.homeDir ?? '', cwd: scene.cwd })
  const read = () => ports.readSession?.(scene) ?? Promise.resolve(null)
  const sessionId = () => scene.sessionId
  const git = async (...args: string[]) => {
    const result = await deps.run?.(['git', '-C', scene.cwd, ...args], scene.cwd).catch(() => null)
    return result?.exitCode === 0 ? result.stdout.trim() : null
  }
  const repo = async () => {
    const root = await git('rev-parse', '--show-toplevel')
    if (!root) return null
    // No repository is Localix's own, so none is `internal` and none is named.
    return { root, remote: await git('remote', 'get-url', 'origin'), internal: false, name: null }
  }

  return {
    models: {
      async complete(call) {
        const system = joined(call.system)
        return resultOf(
          await ports.complete(scene, {
            prompt: joined(call.prompt),
            maxTokens: call.maxTokens,
            signal: call.signal,
            ...(call.model ? { model: call.model } : {}),
            ...(system ? { system } : {}),
            ...(call.effort ? { effort: call.effort } : {}),
            ...(call.timeoutMs === undefined ? {} : { timeoutMs: call.timeoutMs }),
          }),
        )
      },
      // A fork asks one more question after the conversation so far; with none yet, it says so.
      async fork(call) {
        const history = ((await read())?.messages ?? []).map(({ role, text }) => ({ role, text }))
        if (history.length === 0) return { isAnswered: false, reason: 'nothing-to-fork' }
        return resultOf(
          await ports.complete(scene, {
            prompt: joined(call.prompt),
            history,
            signal: call.signal,
          }),
        )
      },
      // A completion with a fixed classifier prompt: the label the model named, or none.
      async classify(request, signal) {
        const labels = (request.labels as readonly string[]) ?? []
        const options = request.options as { model?: string } | undefined
        const reply = resultOf(
          await ports.complete(scene, {
            ...(options?.model ? { model: options.model } : {}),
            system: CLASSIFY_SYSTEM,
            prompt: `Labels: ${labels.join(', ')}\n\nText:\n${String(request.text)}`,
            maxTokens: 64,
            signal,
          }),
        )
        if (!reply.isAnswered) throw new Error(`$.model.classify: ${reply.reason}`)
        const said = reply.text.trim().replace(/^["'`]|["'`.]$/g, '')
        return labels.find((label) => label === said) ?? labels.find((l) => said.includes(l))
      },
    },
    session: {
      messages: async () =>
        ((await read())?.messages ?? []).map((message): SessionEntry => ({
          role: message.role,
          text: message.text,
          // As JSON writes them: a tool's record holds plain data.
          toolUses: message.toolUses.map((use) => JSON.parse(JSON.stringify(use))),
        })),
      cwd: async () => scene.cwd,
      root: async () => (await repo())?.root ?? scene.cwd,
      model: async () => (await read())?.model ?? '',
      turns: async () => ((await read())?.messages ?? []).filter((m) => m.role === 'user').length,
      id: async () => {
        const id = sessionId()
        if (!id) throw new Error('$.session.id: no conversation here')
        return id
      },
      repo,
      surfaces: async () => ['desktop'],
      async usage() {
        const session = await read()
        return {
          context: contextUsage({
            window: session?.context?.window ?? 0,
            tokens: session?.context?.tokens,
          }),
          rateLimits: [],
          cost: { usd: session?.costUsd ?? 0 },
          startedAt: session?.startedAt ?? Date.now(),
        }
      },
      version: async () => VERSION,
      compact: () => deps.compact?.() ?? unsupported('$.session.compact')(),
      // Localix delivers between conversations through its own agents; a mod's message is not sent.
      send: async () => ({
        isDelivered: false,
        reason: 'Localix delivers between conversations through its own agents, not a mod',
      }),
      async append(row) {
        const id = sessionId()
        const message = row.message as { content?: readonly { text?: unknown }[] }
        const text = (message.content ?? [])
          .map((block) => block.text)
          .filter((part): part is string => typeof part === 'string')
          .join('\n')
        if (!id) return { deny: 'No conversation to append to' }
        if (!text) return { deny: '$.session.append takes text blocks' }
        composer.note(id, text)
        return { message: { type: 'user', content: [{ type: 'text', text }] }, uuid: randomUUID() }
      },
      // Localix reaches models through its own provider connections: no Anthropic session to lend.
      authorize: async () => null,
    },
    prompts: {
      async submit(prompt) {
        const input = {
          text: prompt.text,
          asUser: prompt.asUser === true,
          plugin: prompt.from ?? '',
        }
        // The prompt met its hooks as this call: its turn, which reads it as the model will, does
        // not fire `prompt.submit` again.
        if (scene.sessionId) composer.submitted(scene.sessionId, submittedContent(input))
        await ports.submitPrompt(scene, input)
        return {}
      },
      // The box's draft lives in the window; a mod sees none, as where no box is mounted.
      read: async () => ({ text: '', cursor: 0 }),
      async fill(text, fill) {
        const id = sessionId()
        if (!id) return { isFilled: false, refusal: 'no_composer' }
        composer.fill(id, text, fill?.mode)
        return { isFilled: true, text, cursor: text.length }
      },
      async suggest(text) {
        const id = sessionId()
        if (id) composer.suggest(id, text)
        return { isShown: id !== undefined }
      },
      compose: () => deps.compose?.() ?? unsupported('$.prompt.compose')(),
    },
    agents: {
      spawn: (definition) => turn.spawn(definition),
      list: async () =>
        ((await ports.listAgentRuns?.(scene).catch(() => [])) ?? []).map((run) => ({
          id: run.sessionId,
          name: run.taskName,
          description: run.taskName,
          type: run.agentId ?? 'self',
          status: agentStatus(run.status),
          ...(run.parentSessionId ? { parentId: run.parentSessionId } : {}),
        })),
    },
    commands: {
      builtIns: deps.builtIns,
      // Localix's own commands and skills, listed before the mods' (`bootstrap/mods-commands.ts`).
      ...(listCommands ? { list: () => listCommands(scene) } : {}),
      run: (command) => deps.runCommand?.(command) ?? unsupported('$.command.run')(),
    },
    tools: turn.tools,
    turns: {
      async abort() {
        if (!ports.abortTurn) throw new Error('$.turn.abort: no turn to stop here')
        await ports.abortTurn(scene)
      },
    },
    // Claude Code's /config menu rows; Localix keeps its settings elsewhere, so it lists none.
    config: {
      list: async () => [],
      set: async (key) => ({ deny: `Localix has no /config row named ${key}` }),
    },
    settings: {
      layers: async () => settingsLayersForMods((await settings()).layers),
      merged: (layers) => mergeModSettingsLayers(layers),
    },
  }
}
