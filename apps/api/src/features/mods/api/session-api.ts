import { randomUUID } from 'node:crypto'
import type { ModScene, ModsPorts } from '../contracts'

/**
 * `$.session`: the conversation a hook runs in, shaped as Claude Code answers it. Localix shows a
 * mod on the desktop, so that is its one surface; the repository is read from git in the working
 * directory.
 */

/**
 * What `$.session.version()` names: Localix, the Claude Code release whose mods it runs as its
 * base, and when this process started (Localix stamps no build time on its server).
 */
const VERSION = {
  version: 'localix',
  base: '2.1.310',
  builtAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
}

export function createSessionApi(input: {
  scene: () => ModScene
  ports: Pick<ModsPorts, 'readSession'>
  /** `$.session.append`: a note the model reads with the conversation's next prompt. */
  append: (sessionId: string, text: string) => void
  run: (argv: string[], cwd: string) => Promise<{ exitCode: number; stdout: string }>
  /** `$.session.compact`: a checkpoint at the conversation's next turn. */
  compact: () => Promise<unknown>
}) {
  const { scene, ports, run } = input
  const read = () => ports.readSession?.(scene()) ?? Promise.resolve(null)
  const git = async (cwd: string, ...args: string[]) => {
    const result = await run(['git', '-C', cwd, ...args], cwd).catch(() => null)
    return result?.exitCode === 0 ? result.stdout.trim() : null
  }
  const repo = async () => {
    const { cwd } = scene()
    const root = await git(cwd, 'rev-parse', '--show-toplevel')
    if (!root) return null
    return { root, remote: await git(cwd, 'remote', 'get-url', 'origin'), internal: false }
  }
  return {
    id: () => scene().sessionId ?? '',
    cwd: () => scene().cwd,
    root: async () => (await repo())?.root ?? scene().cwd,
    repo,
    messages: async () => (await read())?.messages ?? [],
    model: async () => (await read())?.model ?? '',
    turns: async () =>
      ((await read())?.messages ?? []).filter((message) => message.role === 'user').length,
    usage: async () => {
      const session = await read()
      const context = session?.context
      return {
        context: {
          window: context?.window ?? 0,
          ...(context?.tokens !== undefined ? { tokens: context.tokens } : {}),
          ...(context?.tokens !== undefined && context.window > 0
            ? { percent: Math.round((context.tokens / context.window) * 100) }
            : {}),
        },
        rateLimits: [],
        cost: { usd: session?.costUsd ?? 0 },
        startedAt: session?.startedAt ?? Date.now(),
      }
    },
    version: () => VERSION,
    surfaces: () => ['desktop'],
    surface: () => 'desktop',
    async append(args: unknown) {
      const sessionId = scene().sessionId
      const message = ((args ?? {}) as { message?: { content?: unknown } }).message
      const blocks = Array.isArray(message?.content) ? message.content : [message?.content]
      const text = blocks
        .map((block) =>
          typeof block === 'string' ? block : (block as { text?: unknown } | null)?.text,
        )
        .filter((part): part is string => typeof part === 'string')
        .join('\n')
      if (!sessionId) return { deny: 'No conversation to append to' }
      if (!text) return { deny: 'session.append takes text blocks' }
      input.append(sessionId, text)
      return { message: { type: 'user', content: [{ type: 'text', text }] }, uuid: randomUUID() }
    },
    // Localix reaches models through its own provider connections: no Anthropic session to lend.
    authorize: async () => null,
    compact: input.compact,
  }
}
