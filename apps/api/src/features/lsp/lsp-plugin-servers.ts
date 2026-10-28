import { managedNpmBin, spawnJsServer, spawnServer, which } from './lsp-bin-resolve'
import { commandInstall } from './lsp-command-installs'
import type { LspServerDef } from './lsp-servers'
import { isRecord } from '../../lib/record'

/**
 * Claude Code `lspServers` config → a runtime {@link LspServerDef}.
 *
 * A plugin (or a `strict:false` marketplace entry) may declare LSP servers with the
 * CC `.lsp.json` shape: a map `{ "<id>": { command, args?, extensionToLanguage, … } }`.
 * We turn each entry into an `LspServerDef` whose `spawn` resolves `command` on PATH
 * (CC requires the binary be installed, never bundled) and starts it over stdio.
 *
 * Every documented field is honored (plugins/manifest-reference, `lspServers`): `args`, `env`,
 * `initializationOptions` (sent at `initialize`), `settings` (the server's configuration),
 * `workspaceFolder` (its root), `startupTimeout`, `requestTimeout` (60 s by default),
 * `shutdownTimeout`, `restartOnCrash`, `maxRestarts`, `diagnostics`, and `extensionToLanguage`'s
 * language ids. `transport: "socket"` is accepted and runs over stdio, as in Claude Code. A config
 * is a strict object: an unknown key keeps that server from loading.
 */

/** One validated CC LSP server config (from `.lsp.json` / inline `lspServers`). */
export interface LspServerConfig {
  /** Executable resolved on PATH — NOT bundled. */
  command: string
  /** Extra CLI args. */
  args?: string[]
  /** Extensions (lowercase, leading dot) → language id; the first spelling of an extension wins. */
  extensionToLanguage: Record<string, string>
  /** The map as written, case kept: `.C` → `cpp` beside `.c` → `c` (clangd-lsp). */
  languageIds?: Record<string, string>
  /** Passed to the server's LSP `initialize` as `initializationOptions`. */
  initializationOptions?: Record<string, unknown>
  /** The server's configuration: `workspace/didChangeConfiguration` and `workspace/configuration`. */
  settings?: Record<string, unknown>
  /** Extra env for the server process. */
  env?: Record<string, string>
  /** The server's root, in place of the project root. */
  workspaceFolder?: string
  startupTimeout?: number
  requestTimeout?: number
  shutdownTimeout?: number
  restartOnCrash?: boolean
  maxRestarts?: number
  /** `false` keeps this server's diagnostics out of the report after an edit. */
  diagnostics?: boolean
}

/** Claude Code's default wait for a request the server never answers. */
export const PLUGIN_LSP_REQUEST_TIMEOUT_MS = 60_000

const KNOWN_KEYS = new Set([
  'command',
  'args',
  'extensionToLanguage',
  'transport',
  'env',
  'initializationOptions',
  'settings',
  'workspaceFolder',
  'startupTimeout',
  'shutdownTimeout',
  'requestTimeout',
  'restartOnCrash',
  'maxRestarts',
  'diagnostics',
])

/** Normalize a CC extension key to the `.ext` (leading-dot, lowercase) form the manager matches on. */
function normalizeExt(ext: string): string {
  const trimmed = ext.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

const serverMap = (raw: unknown): Record<string, unknown> =>
  !isRecord(raw) ? {} : isRecord(raw.lspServers) ? raw.lspServers : raw

/** Why one server config cannot load, or undefined when it is a valid strict object. */
function configProblem(cfg: unknown): string | undefined {
  if (!isRecord(cfg)) return 'expected an object'
  const unknown = Object.keys(cfg).find((key) => !KNOWN_KEYS.has(key))
  if (unknown) return `unknown key "${unknown}"`
  if (typeof cfg.command !== 'string' || !cfg.command.trim()) return '"command" is required'
  if (!isRecord(cfg.extensionToLanguage) || !Object.keys(cfg.extensionToLanguage).length)
    return '"extensionToLanguage" needs at least one entry'
  if (cfg.transport !== undefined && cfg.transport !== 'stdio' && cfg.transport !== 'socket')
    return '"transport" must be "stdio" or "socket"'
  return undefined
}

/** The servers of a raw `lspServers` map that cannot load, in Claude Code's words. */
export function lspServerConfigProblems(raw: unknown): string[] {
  return Object.entries(serverMap(raw)).flatMap(([id, cfg]) => {
    const problem = configProblem(cfg)
    return problem ? [`Invalid LSP server config for "${id}": ${problem}`] : []
  })
}

const positive = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined

/**
 * Parse a raw `lspServers` map (the `.lsp.json` / inline object) into validated
 * {@link LspServerConfig}s keyed by id. A config that breaks the strict shape is dropped
 * ({@link lspServerConfigProblems} says why). Pure — no I/O.
 */
export function parseLspServersConfig(raw: unknown): Record<string, LspServerConfig> {
  const out: Record<string, LspServerConfig> = {}
  for (const [id, cfgRaw] of Object.entries(serverMap(raw))) {
    if (configProblem(cfgRaw) || !isRecord(cfgRaw)) continue
    const extensionToLanguage: Record<string, string> = {}
    const languageIds: Record<string, string> = {}
    for (const [ext, lang] of Object.entries(cfgRaw.extensionToLanguage as object)) {
      const norm = normalizeExt(ext)
      if (!norm || typeof lang !== 'string') continue
      extensionToLanguage[norm] ??= lang
      languageIds[ext.startsWith('.') ? ext : `.${ext}`] = lang
    }
    if (Object.keys(extensionToLanguage).length === 0) continue
    const args = Array.isArray(cfgRaw.args)
      ? cfgRaw.args.filter((a): a is string => typeof a === 'string')
      : undefined
    const env: Record<string, string> = {}
    if (isRecord(cfgRaw.env)) {
      for (const [k, v] of Object.entries(cfgRaw.env)) if (typeof v === 'string') env[k] = v
    }
    const ownCase = Object.keys(languageIds).some((ext) => !(ext in extensionToLanguage))
    const maxRestarts =
      typeof cfgRaw.maxRestarts === 'number' && cfgRaw.maxRestarts >= 0
        ? Math.floor(cfgRaw.maxRestarts)
        : undefined
    const optional: Partial<LspServerConfig> = {
      ...(args?.length ? { args } : {}),
      ...(ownCase ? { languageIds } : {}),
      ...(isRecord(cfgRaw.initializationOptions)
        ? { initializationOptions: cfgRaw.initializationOptions }
        : {}),
      ...(isRecord(cfgRaw.settings) ? { settings: cfgRaw.settings } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(typeof cfgRaw.workspaceFolder === 'string' && cfgRaw.workspaceFolder
        ? { workspaceFolder: cfgRaw.workspaceFolder }
        : {}),
      ...(positive(cfgRaw.startupTimeout)
        ? { startupTimeout: positive(cfgRaw.startupTimeout) }
        : {}),
      ...(positive(cfgRaw.requestTimeout)
        ? { requestTimeout: positive(cfgRaw.requestTimeout) }
        : {}),
      ...(positive(cfgRaw.shutdownTimeout)
        ? { shutdownTimeout: positive(cfgRaw.shutdownTimeout) }
        : {}),
      ...(typeof cfgRaw.restartOnCrash === 'boolean'
        ? { restartOnCrash: cfgRaw.restartOnCrash }
        : {}),
      ...(maxRestarts !== undefined ? { maxRestarts } : {}),
      ...(typeof cfgRaw.diagnostics === 'boolean' ? { diagnostics: cfgRaw.diagnostics } : {}),
    }
    out[id] = { command: (cfgRaw.command as string).trim(), extensionToLanguage, ...optional }
  }
  return out
}

/** The language id a file opens with: its extension as written, then lowercased. */
function languageIdOf(config: LspServerConfig, filePath: string): string | undefined {
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  const dot = base.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = base.slice(dot)
  return config.languageIds?.[ext] ?? config.extensionToLanguage[ext.toLowerCase()]
}

/**
 * Build an {@link LspServerDef} from a validated CC config. The server handles the config's file
 * extensions, roots at its `workspaceFolder` or the project root, and spawns `command` (resolved
 * on PATH, else installed on first use when Localix knows it) over stdio with the plugin's path
 * variables (`process.env`) beneath its own `env`. A
 * server that exited on its own starts again only while `restartOnCrash` and `maxRestarts` allow.
 */
export function configuredLspServer(
  id: string,
  config: LspServerConfig,
  plugin: { env?: Record<string, string> } = {},
): LspServerDef {
  let crashes = 0
  // Not on PATH: installed on first use when Localix knows the command (`lsp-command-installs.ts`).
  const managed = commandInstall(config.command)
  const mayStart = () =>
    crashes === 0 ||
    (config.restartOnCrash !== false &&
      (config.maxRestarts === undefined || crashes <= config.maxRestarts))
  return {
    id,
    extensions: Object.keys(config.extensionToLanguage),
    ...(config.diagnostics === false ? { reportsDiagnostics: false } : {}),
    resolveRoot(_filePath, projectRoot) {
      return config.workspaceFolder ?? projectRoot
    },
    ...(managed ? { install: managed.package } : {}),
    async spawn(rootDir, _projectRoot, installed) {
      if (!mayStart()) return undefined
      const args = config.args ?? []
      const env = { ...plugin.env, ...config.env }
      const onPath = which(config.command)
      let proc
      if (managed?.npmBin) {
        // An npm server runs with Localix's own Bun wherever it was found: its
        // `#!/usr/bin/env node` would otherwise need a Node install.
        const bin = onPath ?? (installed ? managedNpmBin(installed, managed.npmBin) : undefined)
        if (!bin) return undefined
        proc = spawnJsServer(bin, args, rootDir, env)
      } else {
        const bin = onPath ?? (installed ? managed?.executable?.(installed) : undefined)
        if (!bin) return undefined
        proc = spawnServer(bin, args, rootDir, env)
      }
      if (!proc) return undefined
      // An exit with no signal is the server's own: a crash (`restartOnCrash` / `maxRestarts`).
      // Shutdown and idle eviction end it with a signal.
      proc.once('exit', (_code, signal) => {
        if (signal === null) crashes++
      })
      return {
        process: proc,
        initialization: config.initializationOptions ?? {},
        ...(config.settings ? { settings: config.settings } : {}),
        ...(config.startupTimeout ? { initializeTimeoutMs: config.startupTimeout } : {}),
        requestTimeoutMs: config.requestTimeout ?? PLUGIN_LSP_REQUEST_TIMEOUT_MS,
        ...(config.shutdownTimeout ? { shutdownTimeoutMs: config.shutdownTimeout } : {}),
        languageIdFor: (filePath: string) => languageIdOf(config, filePath),
      }
    },
  }
}
