import { which } from './lsp-bin-resolve'
import { commandInstall, firstUseNote, toolchainHint } from './lsp-command-installs'
import { parseLspServersConfig, type LspServerConfig } from './lsp-plugin-servers'
import { getServersForExtension } from './lsp-servers'

/**
 * What a plugin's declared LSP servers will actually do on this machine: which file
 * extensions each one serves, whether its binary is on PATH, and which extensions a
 * built-in server already owns (the built-in is kept; the plugin server skips them).
 * Feeds the plugin validation notes (Settings, `/plugin details`) and the prompt's
 * plugin index, so the agent and the user see the same answer.
 */

export interface PluginLspServerSummary {
  id: string
  command: string
  /** Extensions this server handles after built-in overlap is removed. */
  extensions: string[]
  /** Extensions a built-in server already handles (left to the built-in). */
  builtinExtensions: string[]
  /** True when `command` is not on PATH and Localix cannot install it. */
  missing: boolean
  /** `command` is not on PATH, and Localix installs it the first time a file needs it. */
  installsOnFirstUse: boolean
  /** What a missing server needs: a toolchain, never a Node package manager. */
  installHint?: string
}

function commandName(command: string): string {
  return command.split(/[\\/]/).pop() ?? command
}

/** Summarize a plugin's raw `lspServers` map (as discovery resolved it). */
export function summarizePluginLspServers(raw: unknown): PluginLspServerSummary[] {
  return Object.entries(parseLspServersConfig(raw)).map(([id, config]) => {
    const all = Object.keys(config.extensionToLanguage)
    const builtinExtensions = all.filter((ext) => getServersForExtension(ext).length > 0)
    const absent = !which(config.command)
    const installable = absent && commandInstall(config.command) !== undefined
    const hint = absent && !installable ? toolchainHint(config.command) : undefined
    return {
      id,
      command: config.command,
      extensions: all.filter((ext) => !builtinExtensions.includes(ext)),
      builtinExtensions,
      missing: absent && !installable,
      installsOnFirstUse: installable,
      ...(hint ? { installHint: hint } : {}),
    }
  })
}

/** Plugin notes (validation warnings) for its LSP servers. */
export function pluginLspNotes(summaries: readonly PluginLspServerSummary[]): string[] {
  const notes: string[] = []
  for (const s of summaries) {
    if (s.builtinExtensions.length)
      notes.push(
        `LSP server "${s.id}": the built-in server already handles ${s.builtinExtensions.join(', ')}; the built-in is kept for those files.`,
      )
    const install = s.installsOnFirstUse ? commandInstall(s.command) : undefined
    if (install && s.extensions.length)
      notes.push(
        `LSP server "${s.id}": ${commandName(s.command)} is not on PATH; ${firstUseNote(install)}.`,
      )
    if (s.missing && s.extensions.length)
      notes.push(
        `LSP server "${s.id}": ${commandName(s.command)} not found on PATH${s.installHint ? ` — ${s.installHint}` : ' — install it and make sure it is on PATH'}.`,
      )
  }
  return notes
}

/** The config with built-in extensions removed, or null when nothing is left to serve. */
export function withoutBuiltinOverlap(config: LspServerConfig): LspServerConfig | null {
  const entries = Object.entries(config.extensionToLanguage).filter(
    ([ext]) => getServersForExtension(ext).length === 0,
  )
  if (!entries.length) return null
  return { ...config, extensionToLanguage: Object.fromEntries(entries) }
}
