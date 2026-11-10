import type { PluginIssue, PluginSession } from '@rsaryev/llx-plugin'
import {
  languageIdFor,
  lspRestartDecision,
  planLspStartup,
  type ResolvedLspServer,
} from '@rsaryev/llx-plugin/loading'

/**
 * A plugin's language server as the kit resolved it for a chat, in the shape Localix's LSP client
 * starts it (`features/lsp/lsp-plugin-servers.ts`). Every value and decision is the kit's: the
 * substituted command line, the environment, the documented defaults, the language a file opens
 * with, whether a crashed server starts again.
 */
export interface PluginLspServer {
  /** `<pluginId>:<name>`: unique across plugins, as the kit asks a host to key a server. */
  readonly id: string
  /** The plugin's id (`name@marketplace`, or the bare name of a folder install). */
  readonly pluginId: string
  /** The key as the plugin wrote it. */
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
  /** What the process gets besides Localix's own environment: its `env` and the path variables. */
  readonly env: Readonly<Record<string, string>>
  readonly workspaceFolder?: string
  /** The extensions it declares, as written (`.C` beside `.c`). */
  readonly extensions: readonly string[]
  readonly initializationOptions?: unknown
  readonly settings?: unknown
  readonly startupTimeoutMs?: number
  readonly requestTimeoutMs: number
  readonly shutdownTimeoutMs?: number
  /** `false`: its diagnostics stay out of the report after an edit. */
  readonly diagnostics: boolean
  /** The language id a file opens with, or undefined when no declared extension is its. */
  languageIdFor(filePath: string): string | undefined
  /** Whether it starts again after a crash, `restartsSoFar` restarts having been made. */
  restarts(restartsSoFar: number): boolean
}

export interface SessionLspServers {
  readonly servers: readonly PluginLspServer[]
  /** The servers that do not start (a variable unset), as the kit reports them. */
  readonly issues: readonly PluginIssue[]
}

function pluginLspServer(server: ResolvedLspServer): PluginLspServer {
  // The process environment as the kit plans the start; whether the binary is found is Localix's.
  const plan = planLspStartup(server, { executableAvailable: true, cwd: '' })
  return {
    id: `${server.pluginId}:${server.name}`,
    pluginId: server.pluginId,
    name: server.name,
    command: server.command,
    args: server.args,
    env: plan.process?.env ?? { ...server.env, ...server.environment },
    ...(server.workspaceFolder === undefined ? {} : { workspaceFolder: server.workspaceFolder }),
    extensions: Object.keys(server.extensionToLanguage),
    ...(server.initializationOptions === undefined
      ? {}
      : { initializationOptions: server.initializationOptions }),
    ...(server.settings === undefined ? {} : { settings: server.settings }),
    ...(server.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: server.startupTimeoutMs }),
    requestTimeoutMs: server.requestTimeoutMs,
    ...(server.shutdownTimeoutMs === undefined
      ? {}
      : { shutdownTimeoutMs: server.shutdownTimeoutMs }),
    diagnostics: server.diagnostics,
    languageIdFor: (filePath) => languageIdFor({ [server.name]: server }, filePath)?.languageId,
    restarts: (restartsSoFar) => lspRestartDecision(server, restartsSoFar) === 'restart',
  }
}

/**
 * The language servers of a chat's plugins (`session.lspServers`): the plugins the run's agent may
 * use, with the chat's folder as `${CLAUDE_PROJECT_DIR}`. A server that cannot start is left out
 * and its issue reported.
 */
export async function sessionLspServers(session: PluginSession): Promise<SessionLspServers> {
  const { resolved, issues } = await session.lspServers()
  return { servers: resolved.map(pluginLspServer), issues }
}
