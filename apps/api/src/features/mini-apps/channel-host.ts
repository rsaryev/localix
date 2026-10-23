import { errorMessage } from '../../lib/errors'
import { localixWorkspaceDir } from '../../lib/env'
import { loadEnabledMiniAppChannels } from './loader-channels'
import type { AvailabilityReader } from '../capabilities/availability'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type {
  ChannelContext,
  ChannelInboundMessage,
  ChannelInboundResult,
  ChannelWorkspaceApi,
  MiniAppChannel,
  MiniAppContext,
} from './native'
import { createDebouncer } from '../../lib/debounce'
import { withTimeout } from '../../lib/timeout'
import type { MiniAppConditions } from '../notifications/conditions/mini-apps'

/** How long shutdown waits for stopped channels' receive loops to unwind. */
const CHANNEL_STOP_GRACE_MS = 3_000

/**
 * Process-wide host for plugin CHANNELS — long-running bridges to external
 * external messaging platforms. Unlike tools/hooks (loaded per
 * agent turn), channels live for the lifetime of the process: started once at
 * boot for every enabled plugin that declares them, restarted when plugin
 * state changes (enable/disable/config), stopped on shutdown.
 *
 * Channels load GLOBAL scope only (like LLM drop-in providers): a platform
 * bridge is a per-user capability, not a per-project one. Each channel's
 * receive loop gets an AbortSignal and the host's `inbound()` bridge, which
 * routes a platform message into a persistent chat session and resolves with
 * the agent's final reply.
 */

export interface ChannelInboundHandler {
  (input: {
    app: string
    channelName: string
    message: ChannelInboundMessage
  }): Promise<ChannelInboundResult>
}

export interface MiniAppChannelHostOptions {
  /**
   * What the rules say about this user's plugins. A PORT: this host owns no storage, and
   * the composition root is the only place that can bind the rule store.
   *
   * No agent is named because a channel runs beside every turn rather than inside one; the
   * root binds it to the agent that always exists (`DEFAULT_AGENT_ID`).
   */
  availabilityFor: (userId: string) => Promise<AvailabilityReader>
  repo: CapabilitySourceRepository
  userId: string
  inbound: ChannelInboundHandler
  /** Workspace management surface handed to channels as `ctx.workspace`. */
  workspace: ChannelWorkspaceApi
  /** Discovery root for project-scoped plugins; defaults to `~/.localix/workspace`. */
  cwd?: string
  /** The user's home (see `discoverPlugins`); `userHome()` in production, a fixture in a test. */
  homeDir: string
  logger?: { info?: (msg: string) => void; warn: (msg: string, meta?: unknown) => void }
  /** A crashed receive loop as a standing Event Center row, cleared when the channel restarts. */
  conditions?: Pick<MiniAppConditions, 'channelStarted' | 'channelCrashed'>
}

interface RunningChannel {
  app: string
  channel: MiniAppChannel
  controller: AbortController
  done: Promise<void>
}

export interface MiniAppChannelHost {
  /** Load enabled plugins' channels and start them. Safe to call once at boot. */
  start(): Promise<void>
  /** Stop everything and start again from current plugin state (debounced). */
  refresh(): void
  /** Stop all running channels (shutdown). */
  stop(): Promise<void>
  /** Names of currently running channels, as `<plugin>:<channel>`. */
  running(): string[]
}

const REFRESH_DEBOUNCE_MS = 500

export function createMiniAppChannelHost(options: MiniAppChannelHostOptions): MiniAppChannelHost {
  const { repo, userId, availabilityFor, inbound, logger } = options
  let channels: RunningChannel[] = []
  const refreshDebouncer = createDebouncer(REFRESH_DEBOUNCE_MS)
  // Serializes start/stop cycles so a refresh during startup can't interleave.
  let lifecycle: Promise<void> = Promise.resolve()

  function startChannel(app: string, channel: MiniAppChannel, ctx: MiniAppContext): RunningChannel {
    const controller = new AbortController()
    const channelCtx: ChannelContext = {
      ...ctx,
      signal: controller.signal,
      inbound: (message) => inbound({ app, channelName: channel.name, message }),
      workspace: options.workspace,
    }
    const done = Promise.resolve()
      .then(() => channel.start(channelCtx))
      .then(() => undefined)
      .catch((err) => {
        if (!controller.signal.aborted) {
          logger?.warn(`channel "${app}:${channel.name}" crashed`, {
            error: errorMessage(err),
          })
          options.conditions?.channelCrashed(app, channel.name, errorMessage(err))
        }
      })
    logger?.info?.(`channel started: ${app}:${channel.name}`)
    // A (re)start is the fix being tried; crashing again reopens the row with its count advanced.
    options.conditions?.channelStarted(app, channel.name)
    return { app, channel, controller, done }
  }

  async function stopAll(): Promise<void> {
    const stopping = channels
    channels = []
    for (const running of stopping) running.controller.abort()
    await Promise.all(
      stopping.map(async (running) => {
        try {
          await running.channel.stop?.()
        } catch (err) {
          logger?.warn(`channel "${running.app}:${running.channel.name}" stop() threw`, {
            error: String(err),
          })
        }
      }),
    )
    // Give receive loops a moment to unwind; never block shutdown on a stuck loop.
    // The abandoned loops keep running — we simply stop waiting for them.
    await withTimeout(Promise.all(stopping.map((r) => r.done)), CHANNEL_STOP_GRACE_MS).catch(
      () => {},
    )
  }

  async function startAll(): Promise<void> {
    // Channels only. This ran the FULL loader — every enabled plugin's SKILL.md files
    // read off disk, its MCP records, agents, prompt sections and LSP configs built —
    // to take one field, at boot and again on every plugin toggle.
    const found = await loadEnabledMiniAppChannels({
      repo,
      availability: await availabilityFor(userId),
      userId,
      projectId: '',
      cwd: options.cwd ?? localixWorkspaceDir(),
      homeDir: options.homeDir,
      logger,
    })
    channels = found.map(({ app, channel, ctx }) => startChannel(app, channel, ctx))
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    lifecycle = lifecycle.catch(() => undefined).then(task)
    return lifecycle
  }

  return {
    start: () => enqueue(startAll),

    refresh() {
      refreshDebouncer.schedule(() => {
        void enqueue(async () => {
          await stopAll()
          await startAll()
        })
      })
    },

    stop: () => {
      // Cancel any pending debounced refresh so a stopAll->startAll can't fire
      // AFTER shutdown and resurrect channel bridges mid-teardown (mirrors the
      // LSP client's dispose() cancelling its diagnostics debouncer).
      refreshDebouncer.cancel()
      return enqueue(stopAll)
    },

    running: () => channels.map((r) => `${r.app}:${r.channel.name}`),
  }
}
