import { which, spawnServer } from './lsp-bin-resolve'
import type { LspServerDef } from './lsp-servers'

/**
 * Claude Code `lspServers` config → a runtime {@link LspServerDef}.
 *
 * A plugin (or a `strict:false` marketplace entry) may declare LSP servers with the
 * CC `.lsp.json` shape: a map `{ "<id>": { command, args?, extensionToLanguage, … } }`.
 * We turn each entry into an `LspServerDef` whose `spawn` resolves `command` on PATH
 * (CC requires the binary be installed, never bundled) and starts it over stdio.
 *
 * What is honored today: `command`, `args`, `extensionToLanguage` (→ handled file
 * extensions), `initializationOptions` (→ server `initialize` params), `env`. Parsed
 * but NOT yet applied: `startupTimeout`, `transport` (stdio only), `settings`,
 * `workspaceFolder`, `maxRestarts`, `diagnostics` — see `docs/features/lsp.md`.
 */

/** One validated CC LSP server config (from `.lsp.json` / inline `lspServers`). */
export interface LspServerConfig {
  /** Executable resolved on PATH — NOT bundled. */
  command: string
  /** Extra CLI args. */
  args?: string[]
  /** Map `".rs" → "rust"`; the keys are the file extensions this server handles. */
  extensionToLanguage: Record<string, string>
  /** Passed to the server's LSP `initialize` as `initializationOptions`. */
  initializationOptions?: Record<string, unknown>
  /** Extra env for the server process. */
  env?: Record<string, string>
  /** Parsed (CC field) but not yet applied — the startup wait is fixed today. */
  startupTimeout?: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Normalize a CC extension key to the `.ext` (leading-dot, lowercase) form the manager matches on. */
function normalizeExt(ext: string): string {
  const trimmed = ext.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

/**
 * Parse a raw `lspServers` map (the `.lsp.json` / inline object) into validated
 * {@link LspServerConfig}s keyed by id. Entries missing the two required fields
 * (`command` + a non-empty `extensionToLanguage`) are dropped. Pure — no I/O.
 */
export function parseLspServersConfig(raw: unknown): Record<string, LspServerConfig> {
  if (!isRecord(raw)) return {}
  // Accept a `{ lspServers: {...} }` wrapper as well as the bare map.
  const map = isRecord(raw.lspServers) ? raw.lspServers : raw
  const out: Record<string, LspServerConfig> = {}
  for (const [id, cfgRaw] of Object.entries(map)) {
    if (!isRecord(cfgRaw)) continue
    const command = typeof cfgRaw.command === 'string' ? cfgRaw.command.trim() : ''
    if (!command) continue
    const extMap = isRecord(cfgRaw.extensionToLanguage) ? cfgRaw.extensionToLanguage : {}
    const extensionToLanguage: Record<string, string> = {}
    for (const [ext, lang] of Object.entries(extMap)) {
      const norm = normalizeExt(ext)
      if (norm && typeof lang === 'string') extensionToLanguage[norm] = lang
    }
    if (Object.keys(extensionToLanguage).length === 0) continue
    const args = Array.isArray(cfgRaw.args)
      ? cfgRaw.args.filter((a): a is string => typeof a === 'string')
      : undefined
    const env: Record<string, string> = {}
    if (isRecord(cfgRaw.env)) {
      for (const [k, v] of Object.entries(cfgRaw.env)) if (typeof v === 'string') env[k] = v
    }
    out[id] = {
      command,
      ...(args?.length ? { args } : {}),
      extensionToLanguage,
      ...(isRecord(cfgRaw.initializationOptions)
        ? { initializationOptions: cfgRaw.initializationOptions }
        : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(typeof cfgRaw.startupTimeout === 'number'
        ? { startupTimeout: cfgRaw.startupTimeout }
        : {}),
    }
  }
  return out
}

/**
 * Build an {@link LspServerDef} from a validated CC config. The server handles the
 * config's file extensions, roots at the project root (CC opens LSP at the workspace),
 * and spawns `command` (resolved on PATH) over stdio. Returns a def whose `spawn`
 * yields `undefined` when the binary is not installed (same graceful path built-ins use).
 */
export function configuredLspServer(id: string, config: LspServerConfig): LspServerDef {
  return {
    id,
    extensions: Object.keys(config.extensionToLanguage),
    resolveRoot(_filePath, projectRoot) {
      return projectRoot
    },
    async spawn(rootDir) {
      const bin = which(config.command)
      if (!bin) return undefined
      const proc = spawnServer(bin, config.args ?? [], rootDir, config.env)
      if (!proc) return undefined
      return { process: proc, initialization: config.initializationOptions ?? {} }
    },
  }
}
