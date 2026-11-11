import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpTimeouts } from '@rsaryev/llx-plugin/format'
import type { ClaudeCodeMcpInput } from './claude-code-servers'
import type { McpServerRecord } from './repository'

/**
 * THE CLAUDE CODE SETTINGS AND SEMANTICS MCP READS, through the host (`plugins/kit`), installed here
 * at boot (A4: the composition root wires it), so `mcp` never imports the kit (the kit builds its
 * records with `mcp`'s builder, so importing it back would be a feature cycle, A6): which servers of
 * Claude Code's files load, a server's `${VAR}` expansion, its time limits and how a remote one is
 * reached. Until a reader is installed a folder has no settings (no Claude Code server, no `env`),
 * and connecting a server is an error (`claudeCodeMcp`).
 */
export interface McpSettingsReader {
  /** The servers a run in `input.cwd` connects (`plugins/kit/settings/mcp-plan.ts`). */
  servers(input: ClaudeCodeMcpInput): McpServerRecord[]
  /** The settings' `env` for the folder a server runs in. */
  folderEnv(cwd: string): Record<string, string>
  /** The config a server connects with under `env` (`plugins/kit/settings/mcp-connect.ts`). */
  connectConfig(
    server: Pick<McpServerRecord, 'config' | 'configExpanded'>,
    env: Readonly<Record<string, string | undefined>>,
  ): Record<string, unknown>
  /** Its connect, tool-call and idle limits under `env`. */
  timeouts(
    server: Pick<McpServerRecord, 'transport' | 'config'>,
    env: Readonly<Record<string, string | undefined>>,
  ): McpTimeouts
  /** Its headers and the fetch that sends them (`plugins/kit/settings/mcp-remote.ts`). */
  remoteRequest(
    server: McpServerRecord,
    config: Record<string, unknown>,
    cwd: string,
    baseFetch: FetchLike,
  ): Promise<McpRemoteRequest>
}

/** How a remote server is reached. */
export interface McpRemoteRequest {
  requestInit?: RequestInit
  fetch: FetchLike
  /** False when an `Authorization` header (static or a helper's) is the server's credential. */
  oauthFallback: boolean
  /** The connection is up: a 401 or 403 from now on re-runs the helper and retries once. */
  connected(): void
}

let installed: McpSettingsReader | undefined

/** Install (or, with `undefined`, remove) the host's reader. One per process, set at boot. */
export function installMcpSettingsReader(reader: McpSettingsReader | undefined): void {
  installed = reader
}

/** The installed reader, if any. */
export function installedMcpSettingsReader(): McpSettingsReader | undefined {
  return installed
}

/** The settings' `env` for the folder a server runs in. */
export function folderSettingsEnv(cwd: string): Record<string, string> {
  return installed?.folderEnv(cwd) ?? {}
}

/** The installed reader; connecting a server without one is a wiring error. */
export function claudeCodeMcp(): McpSettingsReader {
  if (!installed) throw new Error('MCP has no Claude Code host: installKitPorts() runs at boot')
  return installed
}
