import { which } from './lsp-bin-resolve'
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
  /** True when `command` is not found on PATH. */
  missing: boolean
  installHint?: string
}

/** Install commands for the language servers the official Claude Code LSP plugins use. */
const INSTALL_HINTS: Record<string, string> = {
  'typescript-language-server': 'npm i -g typescript-language-server typescript',
  'pyright-langserver': 'npm i -g pyright',
  'rust-analyzer': 'rustup component add rust-analyzer',
  gopls: 'go install golang.org/x/tools/gopls@latest',
  clangd: 'brew install llvm (macOS) or apt install clangd',
  jdtls: 'brew install jdtls',
  'kotlin-language-server': 'brew install kotlin-language-server',
  'lua-language-server': 'brew install lua-language-server',
  intelephense: 'npm i -g intelephense',
  'sourcekit-lsp': 'install Xcode or the Swift toolchain',
  'csharp-ls': 'dotnet tool install -g csharp-ls',
  'ruby-lsp': 'gem install ruby-lsp',
}

function commandName(command: string): string {
  return command.split(/[\\/]/).pop() ?? command
}

export function lspInstallHint(command: string): string | undefined {
  return INSTALL_HINTS[commandName(command)]
}

/** Summarize a plugin's raw `lspServers` map (as discovery resolved it). */
export function summarizePluginLspServers(raw: unknown): PluginLspServerSummary[] {
  return Object.entries(parseLspServersConfig(raw)).map(([id, config]) => {
    const all = Object.keys(config.extensionToLanguage)
    const builtinExtensions = all.filter((ext) => getServersForExtension(ext).length > 0)
    const hint = lspInstallHint(config.command)
    return {
      id,
      command: config.command,
      extensions: all.filter((ext) => !builtinExtensions.includes(ext)),
      builtinExtensions,
      missing: !which(config.command),
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
