import { constants, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { asStringArray } from '../../lib/coerce'
import { pathExists } from '../ext/fs-discovery'

import type { PluginManifest } from './contracts'
import {
  componentSources,
  DEFAULT_LOCATIONS,
  type ClaudePluginManifest,
  type MergedSource,
} from '@localixai/claude-plugin'
import { parseMonitors, type PluginMonitor } from './contracts-monitors'
import { toAbsList } from './discovery-paths'
import { collectMarkdownFiles, type CollectedMarkdownFile } from './discovery-cc-files'

/**
 * Manifest → absolute artifact paths. Given a plugin directory and its parsed
 * manifest, resolve every declared (or defaulted) artifact location to an absolute
 * path. Pure path/FS resolution — no manifest validation, no plugin-code loading.
 */

/** Absolute paths to every artifact a plugin manifest points at (defaults applied). */
export interface ResolvedEntrypoints {
  /** Native JS/TS entrypoints exporting AgentTools (+ optional hooks). */
  toolEntries: string[]
  /** Skill root dirs — each holds `<name>/SKILL.md`. */
  skillDirs: string[]
  /** MCP server configs keyed by server name (raw, normalized later). */
  mcpServers: Record<string, Record<string, unknown>>
  /** Claude Code flat-file commands — resolved `.md` paths + namespaced names (default `commands/` recursive + manifest string entries). */
  commandFiles: CollectedMarkdownFile[]
  /** Claude Code agent files — resolved `.md` paths + namespaced names (default `agents/` recursive + manifest string entries). */
  agentFiles: CollectedMarkdownFile[]
  /**
   * Claude Code declarative hook configs — raw parsed JSON from the manifest `hooks`
   * field (string path / array of paths / inline object) or the default
   * `hooks/hooks.json`. Each entry is fed to the cc-hooks pipeline by the loader.
   */
  hookConfigs: unknown[]
  /**
   * Claude Code LSP server configs — raw parsed map from the manifest `lspServers`
   * field (string path / array of paths / inline object) or the default `.lsp.json`.
   * Merged, keyed by server id; parsed into runtime servers by the loader/LSP feature.
   */
  lspServers: Record<string, unknown>
  /**
   * Claude Code background monitors — typed + de-duplicated from the manifest `monitors`
   * field (top-level or promoted `experimental.monitors`) or the default
   * `monitors/monitors.json`. Spawned (enabled plugins only) by the monitor host.
   */
  monitors: PluginMonitor[]
  /**
   * Fields where CC REPLACE semantics actually hid an existing default dir: set for a
   * CC-origin plugin whose manifest lists `commands`/`agents` paths while the default
   * `commands/`/`agents/` dir ALSO exists (and was therefore NOT scanned). Consumed by
   * validate-compat to surface an advisory — behavior differs from the old additive scan.
   */
  ccReplacedDefaults?: Array<'commands' | 'agents'>
  /** Non-fatal static artifact failures surfaced by plugin validation. */
  diagnostics?: PluginArtifactDiagnostic[]
}

export interface PluginArtifactDiagnostic {
  kind: 'command' | 'agent' | 'entrypoint'
  path: string
  message: string
}

/** Read + JSON-parse a file, returning `undefined` on any read/parse error (contributes nothing). */
async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** Read an `.mcp.json`-style file: accepts `{ mcpServers: {…} }` or a bare `{ name: {…} }`. */
async function readMcpJson(file: string): Promise<Record<string, Record<string, unknown>>> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const servers = (parsed.mcpServers ?? parsed) as Record<string, unknown>
    const out: Record<string, Record<string, unknown>> = {}
    for (const [k, v] of Object.entries(servers)) {
      if (v && typeof v === 'object') out[k] = v as Record<string, unknown>
    }
    return out
  } catch {
    return {}
  }
}

/**
 * A merged component's configs in Claude Code's order: the default file when it exists, then
 * each listed file (read with `read`) and inline map as the manifest lists them.
 */
async function mergedConfigs<T>(
  dir: string,
  defaultFile: string,
  source: MergedSource,
  read: (file: string) => Promise<T | undefined>,
): Promise<Array<T | Record<string, unknown>>> {
  const fallback = join(dir, defaultFile)
  const files = toAbsList(dir, source.files).filter((file) => file !== fallback)
  const [first, ...listed] = await Promise.all([
    pathExists(fallback).then((exists) => (exists ? read(fallback) : undefined)),
    ...files.map(read),
  ])
  return [
    ...[first, ...listed].filter((config): config is Awaited<T> => config !== undefined),
    ...source.inline,
  ]
}

/**
 * Resolve a manifest's declared artifacts to absolute paths, applying directory
 * defaults (./tools, ./skills, ./.mcp.json) when the manifest is silent. Commands are
 * inline manifest objects — no filesystem default.
 */
export async function resolveEntrypoints(
  dir: string,
  manifest: PluginManifest,
): Promise<ResolvedEntrypoints> {
  const diagnostics: PluginArtifactDiagnostic[] = []
  // ---- Native tool entrypoints --------------------------------------------
  let toolEntries = toAbsList(dir, manifest.tools)
  if (toolEntries.length === 0) {
    // Check default tool entrypoints in parallel, take the first that exists.
    const candidates = [
      'tools/index.ts',
      'tools/index.js',
      'tools/index.mjs',
      'tools.ts',
      'tools.js',
      'tools.mjs',
    ]
    const checks = await Promise.all(
      candidates.map(async (c) => {
        const abs = join(dir, c)
        return (await pathExists(abs)) ? abs : null
      }),
    )
    const found = checks.find((c) => c !== null)
    if (found) toolEntries = [found]
  }
  await Promise.all(
    toolEntries.map(async (entry) => {
      try {
        const stat = await fs.stat(entry)
        if (!stat.isFile()) {
          diagnostics.push({
            kind: 'entrypoint',
            path: entry,
            message: 'Native entrypoint is not a regular file',
          })
          return
        }
        await fs.access(entry, constants.R_OK)
      } catch (error) {
        diagnostics.push({
          kind: 'entrypoint',
          path: entry,
          message: `Cannot read native entrypoint: ${error instanceof Error ? error.message : 'unknown filesystem error'}`,
        })
      }
    }),
  )

  // ---- Skill dirs ----------------------------------------------------------
  // CC path-behavior: `skills` ADDS to the default `./skills` dir (never replaces it).
  // Always include the default unless it doesn't exist; listed paths go in front.
  // CC v2.1.142+: a plugin with SKILL.md at its root is a single-skill plugin —
  // no `skills: ["./"]` in plugin.json required. Auto-include the plugin root.
  const explicitSkillDirs = toAbsList(dir, manifest.skills)
  const defaultSkillDir = join(dir, 'skills')
  const [rootHasSkillMd, defaultExists] = await Promise.all([
    pathExists(join(dir, 'SKILL.md')),
    pathExists(defaultSkillDir),
  ])
  // Deduplicate so a manifest can't declare the same skill dir twice (causes double-scanning).
  const skillDirSet = new Set([
    ...explicitSkillDirs,
    ...(rootHasSkillMd && !explicitSkillDirs.includes(dir) ? [dir] : []),
    ...(defaultExists && !explicitSkillDirs.includes(defaultSkillDir) ? [defaultSkillDir] : []),
  ])
  const skillDirs = [...skillDirSet]

  // ---- MCP servers ---------------------------------------------------------
  // CC: `.mcp.json` loads first, then each listed file or inline map; a later name replaces an
  // earlier one.
  const sources = componentSources({
    hooks: manifest.hooks,
    mcpServers: manifest.mcpServers,
    lspServers: manifest.lspServers,
  } as Partial<ClaudePluginManifest>)
  const mcpServers: Record<string, Record<string, unknown>> = {}
  for (const servers of await mergedConfigs(
    dir,
    DEFAULT_LOCATIONS.mcpServers,
    sources.mcpServers,
    readMcpJson,
  ))
    Object.assign(mcpServers, servers)

  // ---- Markdown commands & agents ------------------------------------------
  // ADDITIVE by default: the default `commands/` / `agents/` dirs are scanned alongside
  // listed paths. `defaultDirs.<field>: false` makes the listed paths the only source
  // (an imported Claude Code plugin records its REPLACE rule this way). Skills always add.
  // When that hides an existing default dir, the field lands in `ccReplacedDefaults`.
  const exclusive = (field: 'commands' | 'agents') => manifest.defaultDirs?.[field] === false
  const [commandFiles, agentFiles] = await Promise.all([
    collectMarkdownFiles(dir, manifest.commands, 'commands', {
      replaceDefault: exclusive('commands'),
      diagnostics,
      kind: 'command',
    }),
    collectMarkdownFiles(dir, manifest.agents, 'agents', {
      replaceDefault: exclusive('agents'),
      diagnostics,
      kind: 'agent',
    }),
  ])
  const ccReplacedDefaults: Array<'commands' | 'agents'> = []
  await Promise.all(
    (['commands', 'agents'] as const).map(async (field) => {
      if (!exclusive(field)) return
      const listsPaths = toAbsList(dir, asStringArray(manifest[field])).length > 0
      if (listsPaths && (await pathExists(join(dir, field)))) ccReplacedDefaults.push(field)
    }),
  )

  // ---- Claude Code declarative hooks ---------------------------------------
  // CC: `hooks/hooks.json` loads first, then each listed hooks file or inline event map; all of
  // them run. Loaded (with substitution) only for ENABLED plugins by the loader.
  const hookConfigs = await mergedConfigs(dir, DEFAULT_LOCATIONS.hooks, sources.hooks, readJson)

  // ---- Claude Code LSP servers ---------------------------------------------
  // CC: `.lsp.json` loads first, then each listed file or inline map; merged, keyed by server
  // id. Parsed + registered (enabled plugins only, scoped to the project root) by the LSP feature.
  const lspServers: Record<string, unknown> = {}
  for (const raw of await mergedConfigs(
    dir,
    DEFAULT_LOCATIONS.lspServers,
    sources.lspServers,
    readJson,
  )) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const rec = raw as Record<string, unknown>
      const map = (
        rec.lspServers && typeof rec.lspServers === 'object' ? rec.lspServers : rec
      ) as Record<string, unknown>
      for (const [k, v] of Object.entries(map)) if (v && typeof v === 'object') lspServers[k] = v
    }
  }

  // ---- Claude Code background monitors -------------------------------------
  // CC: `monitors` (top-level or promoted from `experimental.monitors`) REPLACES the
  // default `monitors/monitors.json` scan; absent → the default file is read. Both
  // sources run through `parseMonitors` for uniform validation + name de-duplication.
  // Only PARSED here — the trust-gated spawn happens in the monitor host (enabled only).
  let monitors: PluginMonitor[] = []
  if (typeof manifest.monitors === 'string') {
    const [file] = toAbsList(dir, manifest.monitors)
    if (file) monitors = parseMonitors(await readJson(file)).monitors
  } else if (manifest.monitors !== undefined) {
    monitors = parseMonitors(manifest.monitors).monitors
  } else {
    const monitorsFile = join(dir, 'monitors', 'monitors.json')
    if (await pathExists(monitorsFile)) {
      monitors = parseMonitors(await readJson(monitorsFile)).monitors
    }
  }

  return {
    toolEntries,
    skillDirs,
    mcpServers,
    commandFiles,
    agentFiles,
    hookConfigs,
    lspServers,
    monitors,
    diagnostics,
    ...(ccReplacedDefaults.length > 0 ? { ccReplacedDefaults } : {}),
  }
}
