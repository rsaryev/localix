import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import type { AssistantMessage } from '@localixai/agent'
import { createScriptVms } from '@localixai/engine-scripts'
import { sessionReadOf } from '../../../apps/api/src/bootstrap/mods-session'
import type { PersistedMessage } from '../../../apps/api/src/features/chat/contracts'
import type { ModsPorts, ModSource } from '../../../apps/api/src/features/mods/contracts'
import { createModsHost } from '../../../apps/api/src/features/mods/host'
import { instanceIdOf } from '../../../apps/api/src/features/mods/instance-id'
import { createModRunScope } from '../../../apps/api/src/features/mods/run-scope'
import { PROBE_PLUGIN } from './fixtures'

/**
 * The probe mod in Localix's own mods host, with no model: the same module Claude Code loads, run
 * in the production VM, its events fired by the code production fires them with — the run scope
 * `intake.ts`, `stream.ts` and `finalize.ts` call, the host's `runCommand` and pane drawing — and
 * only the ports to the rest of Localix faked: a model that answers `ok` (so `$.model.*` runs
 * Localix's real shaping code), and a conversation read from stored rows through the composition
 * root's own `sessionReadOf`. Two sessions, as `observe` runs two `claude -p`: one that only runs
 * `/probe`, and one with a turn that writes a file and answers.
 */

const MODEL = 'claude-haiku-4-5'
const USAGE = {
  input_tokens: 12,
  output_tokens: 3,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}
const vms = createScriptVms()

export interface LocalixRecording {
  probe: string
  entries: { kind: string; name: string; shape: unknown }[]
}

/** Stored rows of a conversation, as chat keeps them, by session. */
type Stored = Map<string, PersistedMessage[]>

function ports(dir: string, stored: Stored, reports: string[]): ModsPorts {
  return {
    dataDir: (plugin) => join(dir, 'data', plugin),
    workspaceDir: dir,
    homeDir: join(dir, 'home'),
    submitPrompt: async () => {},
    // What the composition root's `complete` resolves to for an answered request, from a model
    // that does as it is told: with labels to choose from, it names the first.
    complete: async (_scene, request) => ({
      isAnswered: true,
      text: /Labels: ([^,\n]+)/.exec(request.prompt)?.[1] ?? 'ok',
      usage: USAGE,
    }),
    log: () => {},
    notify: () => {},
    changed: () => {},
    report: (plugin, message) => reports.push(`${plugin}: ${message}`),
    readSession: async (scene) =>
      scene.sessionId ? sessionReadOf(stored.get(scene.sessionId) ?? [], MODEL) : null,
  }
}

const row = (sessionId: string, id: string, payload: Record<string, unknown>) =>
  ({
    id,
    sessionId,
    userId: 'u',
    payload,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as PersistedMessage

/** Localix's Write tool as the run hands it to the mods: its name and its input's shape. */
function writeTool(written: string[]): AgentTool {
  return defineAgentTool({
    name: 'write',
    description: 'Write files',
    activeVerb: 'Writing',
    inputSchema: z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })) }),
    execute: async (_id, input) => {
      written.push(...input.files.map((file) => file.path))
      // What Localix's write tool reports of each file, which its Claude Code result is made from.
      return {
        content: `Wrote ${input.files.length} file`,
        details: { files: input.files.map((file) => ({ path: file.path, created: true })) },
      }
    },
  }) as AgentTool
}

async function startHost(dir: string, output: string, stored: Stored, reports: string[]) {
  const host = createModsHost(ports(dir, stored, reports), { vms })
  const source: ModSource = {
    plugin: PROBE_PLUGIN.name,
    root: PROBE_PLUGIN.root,
    module: PROBE_PLUGIN.module,
    options: { output, allowModel: true },
    revision: '1',
  }
  await host.reconcile([source])
  if (!host.loaded().includes(source.plugin))
    throw new Error(`the probe did not load in Localix: ${reports.join('; ')}`)
  return host
}

/** Session one: `/probe` in a conversation with no turn yet. */
async function commandSession(dir: string, output: string, reports: string[]) {
  const stored: Stored = new Map([['s-command', []]])
  const host = await startHost(dir, output, stored, reports)
  const plugins = new Set([PROBE_PLUGIN.name])
  await host.runCommand(
    { command: 'probe', args: '' },
    { userId: 'u', sessionId: 's-command', cwd: dir },
    plugins,
  )
  await host.panes.render(instanceIdOf(PROBE_PLUGIN.name, dir), 'cc-parity-probe')
  // The band above the conversation's prompt box, as its composer draws it.
  await host.band.render('s-command', { columns: 100, rows: 12 })
  await host.stop()
}

/** Session two: a turn that writes one file with the Write tool, then answers in one line. */
async function turnSession(dir: string, output: string, reports: string[]) {
  const sessionId = 's-turn'
  const stored: Stored = new Map([[sessionId, []]])
  const host = await startHost(dir, output, stored, reports)
  const scene = { userId: 'u', sessionId, cwd: dir }
  const scope = await createModRunScope(host, scene, new Set([PROBE_PLUGIN.name]), {
    model: MODEL,
  })
  const prompt = 'Write ok to note.txt, then answer in one line.'
  const turnId = 'turn-1'
  // intake.ts: `prompt.submit`, then `turn.start` with what the mods left of the prompt.
  const submitted = await scope.submit(prompt, turnId)
  stored.get(sessionId)!.push(row(sessionId, 'm1', { role: 'user', content: prompt }))
  await scope.turnStart(submitted.dropped ? prompt : submitted.text, turnId)

  // The permission gate sits innermost in the tool-call chain when mods hear `tool.call` or
  // `tool.check` (`chain-gate.ts`): it reviews the call with `tool.check`, then the tool runs.
  const written: string[] = []
  const write = writeTool(written)
  const check = scope.toolCheck()
  const gated: AgentTool = {
    ...write,
    async execute(toolCallId, input, signal, onUpdate, context) {
      const verdict = check?.review
        ? await check.review({ toolCallId, toolName: write.name, input }, { decision: 'allow' })
        : { decision: 'allow' }
      if (verdict.decision === 'deny') return { content: 'denied', isError: true }
      return write.execute(toolCallId, input, signal, onUpdate, context)
    },
  }
  const [tool] = scope.wrapTools([gated])
  const step = scope.modelStep(turnId)
  const answer = (content: AssistantMessage['content']): AssistantMessage => ({
    role: 'assistant',
    content,
    model: MODEL,
    stopReason: content.some((part) => part.type === 'tool_call') ? 'tool_use' : 'end_turn',
    usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
    timestamp: 0,
  })
  const files = [{ path: 'note.txt', content: 'ok' }]
  const call = { type: 'tool_call' as const, id: 'toolu_1', name: 'write', arguments: { files } }
  // stream.ts: each model request through `turn.step`.
  const first = { index: 0, modelId: MODEL, messageCount: 1 }
  await step?.(first, async () => answer([call]))
  await tool!.execute('toolu_1', { files })
  const second = { index: 1, modelId: MODEL, messageCount: 3 }
  await step?.(second, async () => answer([{ type: 'text', text: 'Done.' }]))
  stored.get(sessionId)!.push(
    row(sessionId, 'm2', {
      role: 'assistant',
      content: 'Done.',
      items: [
        {
          toolCallId: 'toolu_1',
          name: 'write',
          input: { files },
          status: 'completed',
          resultText: 'Wrote 1 file',
        },
      ],
    }),
  )
  // finalize.ts: `turn.complete` with the answer and how long the turn took.
  // finalize.ts: the turn's token totals, as the run counted them, and the model that answered.
  const usage = {
    input_tokens: 120,
    output_tokens: 8,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    model: MODEL,
  }
  await scope.turnComplete({ answer: 'Done.', turnId, durationMs: 1200, reason: 'answer', usage })
  await host.stop()
  if (written.length !== 1) throw new Error('the Write tool did not run in the Localix turn')
}

/** Run the probe through both sessions in `dir`, and return what it recorded. */
export async function observeLocalix(dir: string): Promise<LocalixRecording> {
  const output = join(dir, 'probe.json')
  const reports: string[] = []
  await commandSession(dir, output, reports)
  await turnSession(dir, output, reports)
  if (!existsSync(output))
    throw new Error(`the probe wrote nothing in Localix: ${reports.join('; ') || 'no reports'}`)
  return JSON.parse(readFileSync(output, 'utf8')) as LocalixRecording
}
