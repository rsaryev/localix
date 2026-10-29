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
    `Invalid mini app UI destination "${destination.uri}". Expected a canonical read-only localix://ui/... or localix://resource/... URI with a short label.`,
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

/** Build the context object passed to a mini app's register()/hooks. `host` is the generic
 *  backend host-service seam — passed only on the boot-time backend load. */
export function makeContext(
  miniAppName: string,
  miniAppDir: string,
  config: MiniAppConfigValues,
  log: (message: string) => void,
  cwd: string,
  userId: string,
  /** The home the mini app's state and data roots live in — the one discovery was given. */
  home: string,
  host?: MiniAppHostServices,
  reportProblem?: MiniAppProblemReporter,
  /**
   * What the per-run load (tools, hooks) carries without a `host`: the boot load already has each
   * in `host`, and both loads hand the mini app the same field on its context.
   */
  perRun: Pick<MiniAppContext, 'sessionStorage' | 'agents' | 'decisions'> = {},
): MiniAppContext {
  const stateDir = miniAppStateDir(miniAppName, home)
  const dataDir = miniAppDataDir(miniAppName, home)
  try {
    mkdirSync(stateDir, { recursive: true })
    mkdirSync(dataDir, { recursive: true })
  } catch {
    // unwritable home — the mini app will surface the error if it actually needs state
  }
  const address = resolveRuntimeAddress()
  return {
    userId,
    config,
    miniAppDir,
    miniAppName,
    log,
    // Bound to the mini app name here, so a mini app can only ever speak as itself. The
    // SESSION is not bound: this context is cached per scope and shared by a parent run
    // and its children, so the caller passes the session it is actually handling.
    ...(reportProblem ? { reportProblem: (problem) => reportProblem(miniAppName, problem) } : {}),
    z,
    defineTool: defineAgentTool,
    cwd,
    // The user is bound HERE, from the mini app context, so a mini app can never read another
    // user's pane by passing an id. The session stays the caller's to supply — it comes from the
    // hook or tool call that is asking, and the host checks it owns the terminal.
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
    oauth: makeMiniAppOAuth(miniAppName),
    stateDir,
    dataDir,
    // One folder per session on every load: routes (boot, through `host`) and tools (per run)
    // resolve the same place, so a tool and a route never disagree about a session's data.
    ...((host?.sessionStorage ?? perRun.sessionStorage)
      ? { sessionStorage: host?.sessionStorage ?? perRun.sessionStorage }
      : {}),
    // Same rule for the agent directory: a route and a tool resolve a name against one registry.
    ...((host?.agents ?? perRun.agents) ? { agents: host?.agents ?? perRun.agents } : {}),
    // And for the decision model: `decide` from a tool used to answer `unavailable` in every chat.
    ...((host?.decisions ?? perRun.decisions)
      ? { decisions: host?.decisions ?? perRun.decisions }
      : {}),
    runtime: { ...address, webhookUrl: resolveWebhookUrl() },
    host,
  }
}
