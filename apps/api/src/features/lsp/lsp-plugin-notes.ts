import { which } from './lsp-bin-resolve'
import { commandInstall, firstUseNote, toolchainHint } from './lsp-command-installs'
import { routedExtensions } from './lsp-plugin-servers'
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

/** A plugin's server as a summary reads it: its name, its command, the extensions it declares. */
export interface PluginLspDeclaration {
  readonly name: string
  readonly command: string
  readonly extensions: readonly string[]
}

/** Summarize a plugin's LSP servers. */
export function summarizePluginLspServers(
  servers: readonly PluginLspDeclaration[],
): PluginLspServerSummary[] {
  return servers.map(({ name, command, extensions }) => {
    const all = routedExtensions(extensions)
    const builtinExtensions = all.filter((ext) => getServersForExtension(ext).length > 0)
    const absent = !which(command)
    const installable = absent && commandInstall(command) !== undefined
    const hint = absent && !installable ? toolchainHint(command) : undefined
    return {
      id: name,
      command,
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

/** The extensions a server is routed, the built-in servers' removed; null when none is left. */
export function withoutBuiltinOverlap(extensions: readonly string[]): string[] | null {
  const own = routedExtensions(extensions).filter((ext) => getServersForExtension(ext).length === 0)
  return own.length ? own : null
}
