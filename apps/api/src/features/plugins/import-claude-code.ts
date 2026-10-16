import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { pathExists } from '../ext/fs-discovery'
import { isCcHookEvent } from '../cc-hooks/contracts'
import { isRecord } from '../../lib/record'
import { PLUGIN_NAME_RE } from './contracts'
import { toAbsList } from './discovery-paths'

/**
 * The ONE module that knows the Claude Code plugin layout. Runtime discovery reads only
 * the native root `plugin.json`; a Claude Code plugin is converted into that format here,
 * at install time (and once at startup for plugins installed before the importer existed).
 *
 * Conversion keeps Claude Code semantics explicit in the native manifest:
 *  - `.claude-plugin/plugin.json` → root `plugin.json`, with `origin: { format: 'claude-code' }`.
 *  - `commands` / `agents` path lists REPLACE the default dirs in Claude Code; native scanning
 *    is additive, so the importer writes `defaultDirs: { <field>: false }`.
 *  - `userConfig` → `config`, `sensitive` → `secret`, `experimental.monitors` → `monitors`.
 *  - `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${user_config.KEY}` are also the
 *    native substitution variables, so they carry over unchanged.
 *  - Hook event names are the native event names; unsupported events are reported as notes.
 */

/** The Claude Code plugin metadata directory (never read by runtime discovery). */
export const CLAUDE_CODE_DIR = '.claude-plugin'
export const CLAUDE_CODE_PLUGIN_MANIFEST = join(CLAUDE_CODE_DIR, 'plugin.json')
export const CLAUDE_CODE_MARKETPLACE = join(CLAUDE_CODE_DIR, 'marketplace.json')

export const CLAUDE_CODE_MARKETPLACE_HINT =
  'This is a Claude Code marketplace; install its plugins individually with /plugin install <owner/repo or path>'

/** Claude Code manifest fields with no native counterpart (kept out of the native manifest). */
const UNSUPPORTED_FIELDS: Record<string, string> = {
  outputStyles: 'output styles are not supported',
  channels: 'Claude Code channels are not supported (native channels use `contributions`)',
}

export interface ClaudeCodeImport {
  /** The native manifest written to `<dir>/plugin.json`. */
  manifest: Record<string, unknown>
  /** Human-readable notes about pieces that did not carry over. */
  notes: string[]
}

/** True when `dir` holds a Claude Code plugin manifest and no native one. */
export async function isClaudeCodePlugin(dir: string): Promise<boolean> {
  const [native, foreign] = await Promise.all([
    pathExists(join(dir, 'plugin.json')),
    pathExists(join(dir, CLAUDE_CODE_PLUGIN_MANIFEST)),
  ])
  return foreign && !native
}

/** True when `dir` carries only a Claude Code marketplace catalog. */
export async function isClaudeCodeMarketplace(dir: string): Promise<boolean> {
  const [native, foreign] = await Promise.all([
    pathExists(join(dir, '.localix-plugin', 'marketplace.json')),
    pathExists(join(dir, CLAUDE_CODE_MARKETPLACE)),
  ])
  return foreign && !native
}

/** Read the `name` a Claude Code manifest declares (null when absent or unreadable). */
export async function readClaudeCodePluginName(dir: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.readFile(join(dir, CLAUDE_CODE_PLUGIN_MANIFEST), 'utf8'))
    return isRecord(raw) && typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null
  } catch {
    return null
  }
}

const asList = (value: unknown): unknown[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value]

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** Collect hook event names a hooks config declares that the host does not dispatch. */
async function unsupportedHookEvents(dir: string, hooks: unknown): Promise<string[]> {
  const configs: unknown[] = []
  if (typeof hooks === 'string' || Array.isArray(hooks)) {
    for (const file of toAbsList(dir, hooks as string | string[]))
      configs.push(await readJson(file))
  } else if (isRecord(hooks)) {
    configs.push(hooks)
  } else {
    configs.push(await readJson(join(dir, 'hooks', 'hooks.json')))
  }
  const events = new Set<string>()
  for (const config of configs) {
    if (!isRecord(config)) continue
    const map = isRecord(config.hooks) ? config.hooks : config
    for (const event of Object.keys(map)) if (!isCcHookEvent(event)) events.add(event)
  }
  return [...events].sort()
}

/** Pure field conversion of a parsed Claude Code manifest (filesystem-free parts). */
export function convertClaudeCodeManifest(
  raw: Record<string, unknown>,
  origin: { source?: string; importedAt?: string },
): ClaudeCodeImport {
  const notes: string[] = []
  const { userConfig, experimental, $schema: _schema, ...rest } = raw
  const out: Record<string, unknown> = { ...rest }
  for (const [field, why] of Object.entries(UNSUPPORTED_FIELDS)) {
    if (out[field] === undefined) continue
    delete out[field]
    notes.push(`\`${field}\`: ${why}`)
  }
  // `userConfig` → `config`; `sensitive` → `secret`.
  const config = out.config ?? userConfig
  if (isRecord(config)) {
    out.config = Object.fromEntries(
      Object.entries(config).map(([key, option]) =>
        isRecord(option) && option.sensitive === true
          ? [key, { ...option, secret: true }]
          : [key, option],
      ),
    )
  }
  if (isRecord(experimental)) {
    if (Array.isArray(experimental.monitors) && out.monitors === undefined)
      out.monitors = experimental.monitors
    if (experimental.themes !== undefined)
      notes.push('`experimental.themes`: themes are not supported')
  }
  // Claude Code REPLACE semantics for listed command/agent paths.
  const defaultDirs: Record<string, boolean> = {}
  for (const field of ['commands', 'agents'] as const) {
    const list = asList(out[field])
    if (!list) continue
    out[field] = list
    if (list.some((entry) => typeof entry === 'string')) defaultDirs[field] = false
  }
  if (Object.keys(defaultDirs).length) out.defaultDirs = defaultDirs
  out.origin = {
    format: 'claude-code',
    ...(origin.source ? { source: origin.source } : {}),
    ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
    ...(origin.importedAt ? { importedAt: origin.importedAt } : {}),
  }
  if (origin.source && out.migratedFrom === undefined) out.migratedFrom = origin.source
  return { manifest: out, notes }
}

/** Raised when a Claude Code manifest cannot be converted. */
export class ClaudeCodeImportError extends Error {}

/**
 * Convert the Claude Code plugin in `dir` into the native layout, in place. Returns null
 * when `dir` is not a Claude Code plugin (already native, or no foreign manifest). The
 * original `.claude-plugin/` folder is left untouched (runtime never reads it), so the
 * conversion deletes no user data and a re-run is a no-op once `plugin.json` exists.
 */
export async function importClaudeCodePlugin(
  dir: string,
  opts: { source?: string; now?: () => string } = {},
): Promise<ClaudeCodeImport | null> {
  if (!(await isClaudeCodePlugin(dir))) return null
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(join(dir, CLAUDE_CODE_PLUGIN_MANIFEST), 'utf8'))
  } catch (error) {
    throw new ClaudeCodeImportError(
      `Invalid Claude Code plugin manifest: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isRecord(raw))
    throw new ClaudeCodeImportError('Claude Code plugin manifest is not an object')
  if (raw.name !== undefined && (typeof raw.name !== 'string' || !PLUGIN_NAME_RE.test(raw.name)))
    throw new ClaudeCodeImportError(
      `Invalid plugin name in Claude Code manifest: ${JSON.stringify(raw.name)}`,
    )
  const result = convertClaudeCodeManifest(raw, {
    source: opts.source,
    importedAt: (opts.now ?? (() => new Date().toISOString()))(),
  })
  const events = await unsupportedHookEvents(dir, result.manifest.hooks)
  if (events.length)
    result.notes.push(`Hook events not dispatched by Localix: ${events.join(', ')}`)
  await fs.writeFile(join(dir, 'plugin.json'), JSON.stringify(result.manifest, null, 2) + '\n')
  return result
}
