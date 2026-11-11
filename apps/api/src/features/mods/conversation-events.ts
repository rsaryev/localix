import { skillPromptInput, type SkillOrigin } from '../plugins/kit'
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
 * conversation's events go to its host with the mods its latest turn ran with; one that never ran
 * a turn gets a host of every loaded mod. The command listing is the workspace host's.
 */

/** Where a conversation's events go now; undefined when no mod runs there. */
async function conversationScope(
  host: ModsHost,
  scene: ModScene,
): Promise<ModEventScope | undefined> {
  const joined = host.conversations.of(scene.sessionId)
  const kit = joined ? await host.hostFor(joined.scene, joined.plugins) : await host.hostFor(scene)
  return kit ? { host, kit, scene: joined ? { ...joined.scene, ...scene } : scene } : undefined
}

/** `skill.prompt`: the text the model reads for a skill typed as `/name`. */
export async function skillPrompt(
  host: ModsHost | undefined,
  scene: ModScene,
  skill: string,
  text: string,
  origin?: SkillOrigin,
): Promise<string> {
  const scope = host ? await conversationScope(host, scene) : undefined
  return scope ? skillPromptIn(scope, skill, text, origin) : text
}

/** The event is the kit's (`skillPromptInput`); absent an origin, the skill reads as built in. */
export async function skillPromptIn(
  scope: ModEventScope,
  skill: string,
  text: string,
  origin?: SkillOrigin,
): Promise<string> {
  if (!hearsIn(scope, 'skill.prompt')) return text
  const input = await skillPromptInput(skill, text, origin)
  const answer = await fireIn(scope, 'skill.prompt', input, (e) => ({
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
  const scope = host && joined ? await conversationScope(host, joined.scene) : undefined
  if (!host || !joined || !scope || !hearsIn(scope, 'session.receive')) return { text }
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
export async function clientEvent(
  host: ModsHost | undefined,
  change: { sessionId: string; clientId: string; attached: boolean; reason?: 'detach' | 'end' },
): Promise<void> {
  const joined = host?.conversations.of(change.sessionId)
  const event = change.attached ? 'session.attach' : 'session.detach'
  const scope = host && joined ? await conversationScope(host, joined.scene) : undefined
  if (!scope || !hearsIn(scope, event)) return
  const input = {
    surface: 'desktop',
    clientId: change.clientId,
    ...(change.attached ? {} : { reason: change.reason ?? 'detach' }),
  }
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
  const kit = host ? await host.workspace() : undefined
  if (!host || !kit) return [...commands]
  const scope: ModEventScope = { host, kit, scene: { userId: '', cwd: host.ports.workspaceDir } }
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
    if (tool.name !== 'Skill') return tool
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
        const loaded = (result as { details?: { skill?: SkillOrigin } }).details?.skill
        return {
          ...result,
          content: await skillPromptIn(scope, input.name, result.content, loaded),
        }
      },
    }
  })
}
