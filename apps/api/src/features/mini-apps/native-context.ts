import { mkdirSync } from 'node:fs'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { isUiNavigationAction } from '@localixai/mini-app-sdk/ui'
import type {
  MiniAppContext,
  MiniAppHostServices,
  MiniAppUi,
  MiniAppUiDestination,
} from '@localixai/mini-app-sdk/backend'
import { resolveRuntimeAddress, resolveWebhookUrl } from '../../lib/runtime-address'
import { makeMiniAppOAuth } from './oauth'
import { miniAppDataDir, miniAppStateDir } from './paths'
import type { MiniAppConfigValues } from './config'
import { makeHelpers } from './native-helpers'
import type { MiniAppProblemReporter } from './problem-reporter'

function invalidMiniAppUiDestination(destination: MiniAppUiDestination): never {
  throw new Error(
    `Invalid plugin UI destination "${destination.uri}". Expected a canonical read-only localix://ui/... or localix://resource/... URI with a short label.`,
  )
}

export function makeMiniAppUi(): MiniAppUi {
  return {
    offer(destination) {
      const action = { type: 'ui.navigate' as const, ...destination }
      return isUiNavigationAction(action) ? action : invalidMiniAppUiDestination(destination)
    },
  }
}

/** Build the context object passed to a plugin's register()/hooks. `host` is the generic
 *  backend host-service seam — passed only on the boot-time backend load. */
export function makeContext(
  pluginName: string,
  pluginDir: string,
  config: MiniAppConfigValues,
  log: (message: string) => void,
  cwd: string,
  userId: string,
  /** The home the plugin's state and data roots live in — the one discovery was given. */
  home: string,
  host?: MiniAppHostServices,
  reportProblem?: MiniAppProblemReporter,
  /** The per-run load's session storage; the boot load already carries it in `host`. */
  sessionStorage?: MiniAppContext['sessionStorage'],
  /** The per-run load's agent directory; the boot load already carries it in `host`. */
  agents?: MiniAppContext['agents'],
): MiniAppContext {
  const stateDir = miniAppStateDir(pluginName, home)
  const dataDir = miniAppDataDir(pluginName, home)
  try {
    mkdirSync(stateDir, { recursive: true })
    mkdirSync(dataDir, { recursive: true })
  } catch {
    // unwritable home — the plugin will surface the error if it actually needs state
  }
  const address = resolveRuntimeAddress()
  return {
    userId,
    config,
    pluginDir,
    pluginName,
    log,
    // Bound to the plugin name here, so a plugin can only ever speak as itself. The
    // SESSION is not bound: this context is cached per scope and shared by a parent run
    // and its children, so the caller passes the session it is actually handling.
    ...(reportProblem ? { reportProblem: (problem) => reportProblem(pluginName, problem) } : {}),
    z,
    defineTool: defineAgentTool,
    cwd,
    // The user is bound HERE, from the plugin context, so a plugin can never read another user's
    // pane by passing an id. The session stays the caller's to supply — it comes from the hook or
    // tool call that is asking, and the host checks it owns the terminal.
    ...(host?.terminalRead
      ? {
          terminalRead: {
            screen: (input) => host.terminalRead!.screen({ userId, ...input }),
            finalScreen: (input) => host.terminalRead!.finalScreen({ userId, ...input }),
            list: (input) => host.terminalRead!.list({ userId, ...input }),
            ...(host.terminalRead.watch
              ? {
                  watch: (input, onEvent) =>
                    host.terminalRead!.watch!({ userId, ...input }, onEvent),
                }
              : {}),
          },
        }
      : {}),
    ...(host?.watchPath ? { watchPath: host.watchPath } : {}),
    helpers: makeHelpers(),
    ui: makeMiniAppUi(),
    oauth: makeMiniAppOAuth(pluginName),
    stateDir,
    dataDir,
    // One folder per session on every load: routes (boot, through `host`) and tools (per run)
    // resolve the same place, so a tool and a route never disagree about a session's data.
    ...((host?.sessionStorage ?? sessionStorage)
      ? { sessionStorage: host?.sessionStorage ?? sessionStorage }
      : {}),
    // Same rule for the agent directory: a route and a tool resolve a name against one registry.
    ...((host?.agents ?? agents) ? { agents: host?.agents ?? agents } : {}),
    runtime: { ...address, webhookUrl: resolveWebhookUrl() },
    host,
  }
}
