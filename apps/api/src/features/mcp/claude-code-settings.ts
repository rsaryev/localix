import type { ClaudeCodeMcpInput } from './claude-code-servers'
import type { McpServerRecord } from './repository'

/**
 * THE CLAUDE CODE SETTINGS MCP READS, through the host (`plugins/kit`), installed here at boot (A4:
 * the composition root wires it), so `mcp` never imports the kit: the kit decides which servers of
 * Claude Code's files load and builds them with `mcp`'s record builder. Until a reader is installed
 * a folder has no settings: no Claude Code server, no `env`.
 */
export interface McpSettingsReader {
  /** The servers a run in `input.cwd` connects (`plugins/kit/settings/mcp-plan.ts`). */
  servers(input: ClaudeCodeMcpInput): McpServerRecord[]
  /** The settings' `env` for the folder a server runs in. */
  folderEnv(cwd: string): Record<string, string>
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
