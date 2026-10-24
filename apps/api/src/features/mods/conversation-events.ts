import type { ModScene } from './contracts'
import {
  cachedIn,
  ENGINE_PROVIDER,
  fieldOf,
  fireIn,
  hearsIn,
  type ModEventScope,
} from './event-scope'
import type { ModsHost } from './host'

/**
 * The mods' events outside a running turn: a skill typed as `/name` (`skill.prompt`), a delivery
 * reaching a conversation (`session.receive`), a window attaching to or leaving one
 * (`session.attach`, `session.detach`), and the command listing (`command.describe`). A
 * conversation's events go to the instances its latest turn ran with; one that never ran a turn
 * goes to the mods enabled in the workspace, running in its project.
 */

/** Where a conversation's events go now. */
async function conversationScope(host: ModsHost, scene: ModScene): Promise<ModEventScope> {
  const joined = host.conversations.of(scene.sessionId)
  if (joined) return { host, scene: { ...joined.scene, ...scene }, plugins: joined.plugins }
  return { host, scene, plugins: await host.instancesFor(scene, new Set(host.loaded())) }
}

/** What `skill.prompt` is told about the skill beside its text (`SkillPromptInput`). */
export interface SkillPromptDetails {
  frontmatter: Record<string, unknown>
  source: string
  pluginName?: string
  path?: string
}

/** `skill.prompt`: the text the model reads for a skill typed as `/name`. */
export async function skillPrompt(
  host: ModsHost | undefined,
  scene: ModScene,
  skill: string,
  text: string,
  details?: SkillPromptDetails,
): Promise<string> {
  if (!host || !host.hears('skill.prompt')) return text
  return skillPromptIn(await conversationScope(host, scene), skill, text, details)
}

export async function skillPromptIn(
  scope: ModEventScope,
  skill: string,
  text: string,
  // Absent, the skill reads as one with no file (`built-in`, `{}`), as the types allow.
  details: SkillPromptDetails = { frontmatter: {}, source: 'built-in' },
): Promise<string> {
  if (!hearsIn(scope, 'skill.prompt')) return text
  const answer = await fireIn(scope, 'skill.prompt', { skill, text, ...details }, (e) => ({
    text: fieldOf(e, 'text') ?? text,
  }))
  const rewritten = fieldOf(answer, 'text')
  return typeof rewritten === 'string' ? rewritten : text
}

/** Where a delivery came from, in Claude Code's words, by the wake's source. */
const ORIGINS: Record<string, string> = {
  loop: 'scheduled-trigger',
  subagent: 'peer-send-message',
  delegator: 'peer-send-message',
  external: 'task-notification',
  plugin: 'task-notification',
  hook: 'task-notification',
  'bg-job': 'task-notification',
  'bg-monitor': 'task-notification',
}

export type Received = { text: string } | { consumed: string }

/** `session.receive`: a delivery's text as it is queued, or taken by a mod. */
export async function receiveDelivery(
  host: ModsHost | undefined,
  delivery: { userId: string; sessionId: string; text: string; source?: string },
): Promise<Received> {
  const { text } = delivery
  const joined = host?.conversations.of(delivery.sessionId)
  if (!host || !joined || !host.hears('session.receive', joined.plugins)) return { text }
  const scope = { host, scene: joined.scene, plugins: joined.plugins }
  const input = {
    origin: { kind: ORIGINS[delivery.source ?? ''] ?? 'unclassified' },
    text,
  }
  const answer = await fireIn(scope, 'session.receive', input, (e) => ({
    text: fieldOf(e, 'text') ?? text,
  }))
  const consumed = fieldOf(answer, 'consumed')
  if (typeof consumed === 'string') {
    host.ports.report(
      [...joined.plugins].join(', '),
      `session.receive: consumed a delivery (${consumed})`,
    )
    return { consumed }
  }
  const rewritten = fieldOf(answer, 'text')
  return { text: typeof rewritten === 'string' ? rewritten : text }
}

/** `session.attach` / `session.detach`: a window joining or leaving a conversation's stream. */
export function clientEvent(
  host: ModsHost | undefined,
  change: { sessionId: string; clientId: string; attached: boolean; reason?: 'detach' | 'end' },
): Promise<void> {
  const joined = host?.conversations.of(change.sessionId)
  const event = change.attached ? 'session.attach' : 'session.detach'
  if (!host || !joined || !host.hears(event, joined.plugins)) return Promise.resolve()
  const input = {
    surface: 'desktop',
    clientId: change.clientId,
    ...(change.attached ? {} : { reason: change.reason ?? 'detach' }),
  }
  const scope = { host, scene: joined.scene, plugins: joined.plugins }
  // Observed only: a hook's answer changes nothing, and a failing one costs the window nothing.
  return fireIn(scope, event, input, () => ({ clientId: change.clientId })).then(
    () => {},
    () => {},
  )
}

interface ListedCommand {
  name: string
  description: string
  argumentHint?: string
  pluginName?: string
}

/**
 * `command.describe`: each listed command as the typeahead shows it — a description, a hint, or
 * left out (`isHidden`). Asked of the mods running in the workspace, and kept until
 * `$.ui.invalidate('command.describe')`.
 */
export async function describeCommands<C extends ListedCommand>(
  host: ModsHost | undefined,
  commands: readonly C[],
): Promise<C[]> {
  if (!host) return [...commands]
  const workspace = host.ports.workspaceDir
  const plugins = new Set(
    [...host.instances()].filter(([, { cwd }]) => cwd === workspace).map(([id]) => id),
  )
  const scope: ModEventScope = { host, scene: { userId: '', cwd: workspace }, plugins }
  if (!hearsIn(scope, 'command.describe')) return [...commands]
  const described = await Promise.all(
    commands.map(async (command): Promise<C | null> => {
      const input = {
        command: command.name,
        description: command.description,
        ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
        isHidden: false,
        immediate: false,
        provider: command.pluginName
          ? { plugin: command.pluginName, tier: 'user' }
          : ENGINE_PROVIDER,
      }
      const answer = await cachedIn(scope, 'command.describe', [input], async () =>
        fireIn(scope, 'command.describe', input, (e) => ({
          description: fieldOf(e, 'description') ?? command.description,
          ...(typeof fieldOf(e, 'argumentHint') === 'string'
            ? { argumentHint: fieldOf(e, 'argumentHint') }
            : {}),
          isHidden: fieldOf(e, 'isHidden') === true,
        })),
      )
      if (fieldOf(answer, 'isHidden') === true) return null
      const description = fieldOf(answer, 'description')
      const hint = fieldOf(answer, 'argumentHint')
      return {
        ...command,
        ...(typeof description === 'string' ? { description } : {}),
        ...(typeof hint === 'string' ? { argumentHint: hint } : {}),
      }
    }),
  )
  return described.flatMap((command) => (command ? [command as C] : []))
}

/** The skill tool's `get` through `skill.prompt`: the text the model reads for the skill. */
export function wrapSkillTool<T extends { name: string; execute: (...args: never[]) => unknown }>(
  tools: readonly T[],
  scope: ModEventScope,
): T[] {
  if (!hearsIn(scope, 'skill.prompt')) return [...tools]
  return tools.map((tool) => {
    if (tool.name !== 'skill') return tool
    const execute = tool.execute as (...args: unknown[]) => Promise<{ content: unknown }>
    return {
      ...tool,
      async execute(...args: unknown[]) {
        const result = await execute(...args)
        const input = (args[1] ?? {}) as { action?: unknown; name?: unknown }
        if (input.action !== 'get' || typeof input.name !== 'string') return result
        if (typeof result.content !== 'string' || (result as { isError?: unknown }).isError)
          return result
        // The skill tool says which skill it loaded (`details.skill`, `agent-core/tools/skill.ts`).
        const loaded = (result as { details?: { skill?: SkillPromptDetails } }).details?.skill
        return {
          ...result,
          content: await skillPromptIn(scope, input.name, result.content, loaded),
        }
      },
    }
  })
}
