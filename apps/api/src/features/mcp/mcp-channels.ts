import type { McpServerRecord } from './repository'
import type { McpClientLike } from './mcp-client-contracts'
import type { McpLogger } from './client-manager-types'
import {
  createPermissionRelay,
  declaresPermissionRelay,
  PERMISSION_VERDICT,
  type PermissionRelay,
} from './mcp-channel-permissions'

/**
 * CLAUDE CODE CHANNELS: an MCP server that pushes events into a running conversation.
 *
 * A channel server declares `capabilities.experimental['claude/channel']` and emits
 * `notifications/claude/channel` with `{ content, meta }`; the event reaches the model as a
 * `<channel source="…" key="value">content</channel>` message, and a two-way channel answers
 * through its own reply tool. A PLUGIN's server is heard once the plugin is enabled — the opt-in
 * Claude Code's `--channels plugin:…` flag gives. A server the person added is heard only when
 * they turned on its `channel` setting, as `--channels server:<name>` opts one in.
 *
 * Clients are shared per scope rather than per chat, so an event goes to the conversation that
 * most recently gathered the server — the one the person is working in, as the session that
 * loaded the server is in Claude Code. The binding is kept (`channel-binding-repository.ts`), so
 * after a restart the composition root starts each bound channel again and its events reach that
 * chat before its next turn. A server that also declares `claude/channel/permission` receives
 * the chat's approval prompts (`mcp-channel-permissions.ts`).
 */

export const CHANNEL_NOTIFICATION = 'notifications/claude/channel'
const CHANNEL_CAPABILITY = 'claude/channel'
const PLUGIN_SERVER_PREFIX = 'plugin:'
/** Claude Code keeps a meta key only when it is an identifier; others are dropped silently. */
const META_KEY = /^[A-Za-z0-9_]+$/

/** Where a channel's events go: the conversation that last gathered its server. */
export interface ChannelTarget {
  userId: string
  sessionId: string
}

/** One event, ready for delivery: the target and the `<channel>` message the model reads. */
export interface ChannelDelivery extends ChannelTarget {
  /** The server's id, `plugin:<plugin>:<server>` — the `source` attribute. */
  serverId: string
  content: string
}

export type ChannelSink = (delivery: ChannelDelivery) => void

/** A kept binding: the server identity and working directory, and the chat it speaks into. */
export interface ChannelBinding extends ChannelTarget {
  serverId: string
  cwd: string
  projectId: string
  /** The gather scope that bound it (`McpGatherOptions.scope`). */
  scope: string
}

export interface ChannelBindingStore {
  save(binding: ChannelBinding, at: string): Promise<void>
  list(): Promise<ChannelBinding[]>
  remove(binding: Pick<ChannelBinding, 'userId' | 'serverId' | 'cwd'>): Promise<void>
}

/** What a gather tells the router about where its servers' channels now speak. */
export interface ChannelBindContext {
  target: ChannelTarget
  cwd: string
  projectId: string
  scope: string
}

/** Whether a connected server is a channel this host listens to. */
export function isChannelServer(server: McpServerRecord, client: McpClientLike): boolean {
  if (!client.getServerCapabilities?.()?.experimental?.[CHANNEL_CAPABILITY]) return false
  return server.id.startsWith(PLUGIN_SERVER_PREFIX) || server.config.channel === true
}

/** A notification's params as Claude Code accepts them; null when `content` is not a string. */
export function channelEvent(
  params: unknown,
): { content: string; meta: Record<string, string> } | null {
  const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : null
  if (typeof record?.content !== 'string') return null
  const meta: Record<string, string> = {}
  if (record.meta && typeof record.meta === 'object')
    for (const [key, value] of Object.entries(record.meta))
      if (META_KEY.test(key) && typeof value === 'string') meta[key] = value
  return { content: record.content, meta }
}

const attribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The message the model reads, in Claude Code's form. */
export function formatChannelMessage(
  source: string,
  event: { content: string; meta: Record<string, string> },
): string {
  const attributes = [
    `source="${attribute(source)}"`,
    ...Object.entries(event.meta).map(([key, value]) => `${key}="${attribute(value)}"`),
  ]
  return `<channel ${attributes.join(' ')}>\n${event.content}\n</channel>`
}

export interface ChannelRouter {
  /**
   * The conversation a gather ran for now hears the channels among its servers. `channel` marks a
   * server already known to be one (persisted metadata), so its binding is kept before it connects.
   */
  bind(
    servers: Iterable<{ key: string; server: McpServerRecord; channel: boolean }>,
    context: ChannelBindContext,
  ): void
  /** A kept binding read back at boot: bound again without being written again. */
  restore(binding: ChannelBinding, key: string, server: McpServerRecord): void
  /** Listen to a freshly connected client, when it is a channel. */
  listen(server: McpServerRecord, key: string, client: McpClientLike, logger?: McpLogger): boolean
  /** Set once by the composition root. */
  deliverTo(sink: ChannelSink | undefined): void
  /** Where bindings are kept; set once by the composition root. */
  keepBindingsIn(store: ChannelBindingStore | undefined, now?: () => string): void
  /** Approval prompts for the chats channels speak into. */
  permissions: PermissionRelay
}

interface Connected {
  client: McpClientLike
  permission: boolean
}

export function createChannelRouter(options: { random?: () => number } = {}): ChannelRouter {
  const targets = new Map<string, ChannelTarget>()
  const contexts = new Map<string, { server: McpServerRecord } & ChannelBindContext>()
  const connected = new Map<string, Connected>()
  /** Identity → the chat last written, so a turn does not rewrite an unchanged binding. */
  const kept = new Map<string, string>()
  const unbound = new Set<string>()
  let sink: ChannelSink | undefined
  let store: ChannelBindingStore | undefined
  let clock: () => string = () => new Date().toISOString()

  const permissions = createPermissionRelay({
    random: options.random,
    channelsFor: (userId, sessionId) =>
      [...connected].flatMap(([key, entry]) => {
        const target = targets.get(key)
        return entry.permission && target?.userId === userId && target.sessionId === sessionId
          ? [{ key, client: entry.client }]
          : []
      }),
  })

  function keep(key: string, logger?: McpLogger) {
    const context = contexts.get(key)
    if (!context || !store) return
    const binding: ChannelBinding = {
      ...context.target,
      serverId: context.server.id,
      cwd: context.cwd,
      projectId: context.projectId,
      scope: context.scope,
    }
    const identity = `${binding.userId}\0${binding.serverId}\0${binding.cwd}`
    if (kept.get(identity) === binding.sessionId) return
    kept.set(identity, binding.sessionId)
    store.save(binding, clock()).catch((err: unknown) => {
      kept.delete(identity)
      logger?.warn(`MCP channel "${context.server.name}" binding was not kept`, {
        error: String(err),
      })
    })
  }

  function receive(server: McpServerRecord, key: string, params: unknown, logger?: McpLogger) {
    const event = channelEvent(params)
    if (!event) return
    const target = targets.get(key)
    if (!target || !sink) {
      // Claude Code drops an event no session listens for; say so once per server, not per line.
      if (!unbound.has(key)) {
        unbound.add(key)
        logger?.warn(`MCP channel "${server.name}" sent an event before any chat used it`)
      }
      return
    }
    sink({ ...target, serverId: server.id, content: formatChannelMessage(server.id, event) })
  }

  return {
    bind(servers, context) {
      for (const { key, server, channel } of servers) {
        targets.set(key, context.target)
        contexts.set(key, { server, ...context })
        unbound.delete(key)
        if (channel || connected.has(key)) keep(key)
      }
    },
    restore(binding, key, server) {
      const { cwd, projectId, scope } = binding
      const target = { userId: binding.userId, sessionId: binding.sessionId }
      targets.set(key, target)
      contexts.set(key, { server, target, cwd, projectId, scope })
      kept.set(`${binding.userId}\0${binding.serverId}\0${cwd}`, binding.sessionId)
    },
    listen(server, key, client, logger) {
      if (!isChannelServer(server, client)) return false
      const entry: Connected = { client, permission: declaresPermissionRelay(client) }
      connected.set(key, entry)
      const previousClose = client.onclose
      client.onclose = () => {
        if (connected.get(key) === entry) connected.delete(key)
        previousClose?.()
      }
      // The fallback hears every method without a handler of its own; only the channel's count.
      const previous = client.fallbackNotificationHandler
      client.fallbackNotificationHandler = async (notification) => {
        if (notification.method === CHANNEL_NOTIFICATION)
          receive(server, key, notification.params, logger)
        else if (notification.method === PERMISSION_VERDICT && entry.permission)
          permissions.verdict(key, notification.params)
        else await previous?.(notification)
      }
      // The first connect is when a server is learned to be a channel: keep its binding now.
      if (targets.has(key)) keep(key, logger)
      return true
    },
    deliverTo(next) {
      sink = next
    },
    keepBindingsIn(next, now) {
      store = next
      if (now) clock = now
    },
    permissions,
  }
}
