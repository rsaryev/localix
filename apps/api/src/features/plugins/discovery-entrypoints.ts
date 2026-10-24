import { join } from 'node:path'

import { asStringArray } from '../../lib/coerce'
import { pathExists } from '../ext/fs-discovery'

import type { PluginManifest } from './contracts'
import {
  componentSources,
  DEFAULT_LOCATIONS,
  type ClaudePluginManifest,
} from '@localixai/claude-plugin'
import { parseMonitors, type PluginMonitor } from './contracts-monitors'
import { toAbsList } from './discovery-paths'
import { findHookModule, mergedConfigs, readJson, readMcpJson } from './discovery-entrypoint-files'
import { readPluginHookFiles } from './discovery-hook-files'
import { collectMarkdownFiles, type CollectedMarkdownFile } from './discovery-cc-files'
import { resolveCcComponents, type PluginCcComponents } from './discovery-cc-components'

/**
 * Manifest → absolute artifact paths. Given a plugin directory and its parsed
 * manifest, resolve every declared (or defaulted) artifact location to an absolute
 * path. Pure path/FS resolution — no manifest validation, no plugin-code loading.
 */

/** Absolute paths to every artifact a plugin manifest points at (defaults applied). */
export interface ResolvedEntrypoints {
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
  /** Hooks files that failed to load, in Claude Code's words (`discovery-hook-files.ts`). */
  hookErrors?: string[]
  /**
   * The hooks module (Claude Code `modules` in a hooks file), absolute and inside the plugin: the
   * plugin is a mod. At most one, as Claude Code allows; the mods host loads it.
   */
  hookModule?: string
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
  /** Monitors entries that break the strict shape: the plugin does not load (Claude Code). */
  monitorErrors?: string[]
  /** Output styles, themes, workflows and default settings (`discovery-cc-components.ts`). */
  components?: PluginCcComponents
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
  kind: 'command' | 'agent'
  path: string
  message: string
}

/**
 * Resolve a manifest's declared artifacts to absolute paths, applying Claude Code's directory
 * defaults (./skills, ./.mcp.json, ./commands, ./agents, hooks/hooks.json…) when the manifest is
 * silent. A plugin runs no Localix code: there is no native entrypoint to find.
 */
export async function resolveEntrypoints(
  dir: string,
  manifest: PluginManifest,
): Promise<ResolvedEntrypoints> {
  const diagnostics: PluginArtifactDiagnostic[] = []

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
    // CC: a root `SKILL.md` is the plugin's one skill only with no `skills/` and no `skills` key.
    ...(rootHasSkillMd && !defaultExists && manifest.skills === undefined ? [dir] : []),
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
  // A Claude Code `commands` object map replaces `commands/` even when it lists no path.
  const commandMap =
    exclusive('commands') &&
    asStringArray(manifest.commands).length === 0 &&
    (manifest.commands?.length || manifest.commandFiles)
  const [listedCommandFiles, agentFiles, mappedCommandFiles] = await Promise.all([
    collectMarkdownFiles(dir, manifest.commands, 'commands', {
      replaceDefault: exclusive('commands'),
      ...(commandMap ? { scanDefault: false } : {}),
      diagnostics,
      kind: 'command',
    }),
    collectMarkdownFiles(dir, manifest.agents, 'agents', {
      replaceDefault: exclusive('agents'),
      diagnostics,
      kind: 'agent',
    }),
    mappedCommands(dir, manifest.commandFiles, diagnostics),
  ])
  const commandFiles = [...mappedCommandFiles, ...listedCommandFiles]
  const ccReplacedDefaults: Array<'commands' | 'agents'> = []
  await Promise.all(
    (['commands', 'agents'] as const).map(async (field) => {
      if (!exclusive(field)) return
      const listsPaths =
        toAbsList(dir, asStringArray(manifest[field])).length > 0 ||
        (field === 'commands' && Boolean(commandMap))
      if (listsPaths && (await pathExists(join(dir, field)))) ccReplacedDefaults.push(field)
    }),
  )

  // ---- Claude Code declarative hooks ---------------------------------------
  // CC: `hooks/hooks.json` loads first, then each listed hooks file or inline event map; all of
  // them run. Loaded (with substitution) only for ENABLED plugins by the loader.
  // A file that fails to load contributes nothing and reports why (`hookErrors`).
  const { configs: hookConfigs, errors: hookErrors } = await readPluginHookFiles(
    dir,
    DEFAULT_LOCATIONS.hooks,
    sources.hooks,
  )
  const hookModule = await findHookModule(dir, sources.hooks.files)

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
  let parsedMonitors: ReturnType<typeof parseMonitors> = { monitors: [], errors: [] }
  if (typeof manifest.monitors === 'string') {
    const [file] = toAbsList(dir, manifest.monitors)
    if (file) parsedMonitors = parseMonitors(await readJson(file))
  } else if (manifest.monitors !== undefined) {
    parsedMonitors = parseMonitors(manifest.monitors)
  } else {
    const monitorsFile = join(dir, 'monitors', 'monitors.json')
    if (await pathExists(monitorsFile)) parsedMonitors = parseMonitors(await readJson(monitorsFile))
  }
  const monitors: PluginMonitor[] = parsedMonitors.monitors
  // Localix's own cap on how many run is not Claude Code's rule: only a broken entry counts.
  const monitorErrors = parsedMonitors.errors.filter((error) => error.startsWith('invalid monitor'))

  const components = await resolveCcComponents(dir, manifest)

  return {
    skillDirs,
    mcpServers,
    commandFiles,
    agentFiles,
    hookConfigs,
    ...(hookErrors.length > 0 ? { hookErrors } : {}),
    ...(hookModule ? { hookModule } : {}),
    lspServers,
    monitors,
    ...(monitorErrors.length ? { monitorErrors } : {}),
    components,
    diagnostics,
    ...(ccReplacedDefaults.length > 0 ? { ccReplacedDefaults } : {}),
  }
}

/** The files a `commands` object map names, each named after its key and carrying its fields. */
async function mappedCommands(
  dir: string,
  entries: PluginManifest['commandFiles'],
  diagnostics: PluginArtifactDiagnostic[],
): Promise<CollectedMarkdownFile[]> {
  const found = await Promise.all(
    Object.entries(entries ?? {}).map(async ([name, { source, ...overrides }]) => {
      const [file] = await collectMarkdownFiles(dir, [source], 'commands', {
        scanDefault: false,
        diagnostics,
        kind: 'command',
      })
      return file ? [{ file: file.file, name, overrides }] : []
    }),
  )
  return found.flat()
}
