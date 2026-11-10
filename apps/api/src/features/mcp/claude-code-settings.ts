import type { ClaudeSettingsInput, SettingsFile } from '../plugins/kit'

/**
 * THE CLAUDE CODE SETTINGS THE MCP READERS USE, read by the host (`plugins/kit`) and installed here
 * at boot (A4: the composition root wires it), so `mcp` never imports the settings reader: the kit
 * itself builds MCP records with `mcp`'s normalizer. Until a reader is installed a folder has no
 * settings: no files, not trusted, nothing locked, no `env`.
 */
export interface McpFolderSettings {
  /** The settings files read, lowest precedence first. */
  files: readonly SettingsFile[]
  /** The folder holding the local file, when it is kept at the repository root. */
  localRoot: string | undefined
  /** Claude Code trusts the folder. */
  trusted: boolean
  /** `strictPluginOnlyCustomization` with `mcp`: `~/.claude.json` and `.mcp.json` are closed. */
  mcpLocked: boolean
  /** The settings' `env` in the folder. */
  env: Record<string, string>
  /** The managed settings folder (`managed-mcp.json`), or null for none. */
  managedDir: string | null
}

export interface McpSettingsReader {
  /** The settings a run in `cwd` reads. */
  read(input: ClaudeSettingsInput & { cwd: string }): McpFolderSettings
  /** The settings' `env` for the folder a server runs in. */
  folderEnv(cwd: string): Record<string, string>
}

let installed: McpSettingsReader | undefined

/** Install (or, with `undefined`, remove) the host's reader. One per process, set at boot. */
export function installMcpSettingsReader(reader: McpSettingsReader | undefined): void {
  installed = reader
}

export function mcpFolderSettings(input: ClaudeSettingsInput & { cwd: string }): McpFolderSettings {
  return (
    installed?.read(input) ?? {
      files: [],
      localRoot: undefined,
      trusted: false,
      mcpLocked: false,
      env: {},
      managedDir: null,
    }
  )
}

/** The settings' `env` for the folder a server runs in. */
export function folderSettingsEnv(cwd: string): Record<string, string> {
  return installed?.folderEnv(cwd) ?? {}
}
