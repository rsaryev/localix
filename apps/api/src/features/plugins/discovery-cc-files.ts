import { promises as fs, type Dirent } from 'node:fs'
import { basename, join } from 'node:path'

import { summarizeZodIssues } from '@localixai/plugin-sdk/backend'

import { asStringArray } from '../../lib/coerce'
import { mapLimit } from '../../lib/map-limit'
import { isPathWithin } from '../../lib/path-containment'
import { readDirentsLimit } from '../../lib/read-dir-limit'
import { mapCcToolList } from '../ext/cc-tool-names'
import { coerceFrontmatterBool, trimmedFrontmatterField } from '../ext/frontmatter'
import {
  parseMarkdownFrontmatter,
  scalarField,
  splitTokenList,
} from '../agent-core/skill-discovery'
import {
  MAX_SKILL_MARKDOWN_BYTES,
  readSkillMarkdownFile,
  skillFileErrorDetail,
} from '../agent-core/skill-file'
import { parseYamlFrontmatterBlock } from '../agent-core/frontmatter-yaml'
import {
  PLUGIN_QUALIFIED_NAME_RE,
  pluginAgentSchema,
  pluginCommandSchema,
  type PluginAgent,
  type PluginCommand,
} from './contracts'
import { toAbsList } from './discovery-paths'
import type { PluginArtifactDiagnostic } from './discovery-entrypoints'

/**
 * Claude Code flat-file (`commands/*.md`, `agents/*.md`) discovery + parsing,
 * split out of discovery.ts. These resolve and parse CC-convention markdown files
 * into PluginCommand/PluginAgent objects. Re-exported from discovery.ts so the
 * loader path is unchanged.
 */

/** A resolved Claude Code flat-file, paired with its namespaced (subdir-derived) name. */
export interface CollectedMarkdownFile {
  /** Absolute path to the `.md` file. */
  file: string
  /**
   * The namespaced name: path segments from the scan root to the file (sans `.md`),
   * joined by `:`. `commands/foo/bar.md` → `foo:bar`; a top-level `deploy.md` → `deploy`.
   */
  name: string
}

const MAX_CC_MARKDOWN_DEPTH = 8
const MAX_CC_MARKDOWN_ENTRIES = 2000
const MAX_CC_MARKDOWN_ROOTS = 64
const MAX_CONCURRENT_CC_MARKDOWN_ROOTS = 8

interface MarkdownScanState {
  canonicalRoot: string
  seenDirs: Set<string>
  entriesSeen: number
  limitReported: boolean
}

/** Recursively collect every `.md` under `root`, namespacing each by its relative path. */
async function scanDirCollect(
  root: string,
  kind: 'command' | 'agent',
  diagnostics: PluginArtifactDiagnostic[],
  explicit: boolean,
  canonicalRoot: string,
): Promise<CollectedMarkdownFile[]> {
  const out: CollectedMarkdownFile[] = []
  const state: MarkdownScanState = {
    canonicalRoot,
    seenDirs: new Set(),
    entriesSeen: 0,
    limitReported: false,
  }
  const reportLimit = (path: string): void => {
    if (state.limitReported) return
    state.limitReported = true
    diagnostics.push({
      kind,
      path,
      message: `Markdown discovery stopped at the ${MAX_CC_MARKDOWN_ENTRIES}-entry limit`,
    })
  }
  const walk = async (
    d: string,
    prefix: string[],
    reportMissing: boolean,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_CC_MARKDOWN_DEPTH) {
      diagnostics.push({
        kind,
        path: d,
        message: `Markdown discovery skipped paths deeper than ${MAX_CC_MARKDOWN_DEPTH} directories`,
      })
      return
    }
    if (state.entriesSeen >= MAX_CC_MARKDOWN_ENTRIES) {
      reportLimit(d)
      return
    }
    let canonicalDir: string
    try {
      canonicalDir = await fs.realpath(d)
    } catch (error) {
      if (reportMissing || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        diagnostics.push({
          kind,
          path: d,
          message: `Cannot resolve ${kind} directory: ${skillFileErrorDetail(error)}`,
        })
      }
      return
    }
    if (!isPathWithin(state.canonicalRoot, canonicalDir)) {
      diagnostics.push({
        kind,
        path: d,
        message: `Refusing symlink escape outside plugin root: ${canonicalDir}`,
      })
      return
    }
    if (state.seenDirs.has(canonicalDir)) return
    state.seenDirs.add(canonicalDir)
    let entries: Dirent[]
    try {
      const remaining = MAX_CC_MARKDOWN_ENTRIES - state.entriesSeen
      const read = await readDirentsLimit(d, remaining)
      entries = read.entries
      if (read.truncated) reportLimit(d)
    } catch (error) {
      if (reportMissing || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        diagnostics.push({
          kind,
          path: d,
          message: `Cannot scan ${kind} directory: ${error instanceof Error ? error.message : 'unknown filesystem error'}`,
        })
      }
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    state.entriesSeen += entries.length
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(d, entry.name), [...prefix, entry.name], true, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const base = entry.name.replace(/\.md$/i, '')
        const file = join(d, entry.name)
        let canonicalFile: string
        try {
          canonicalFile = await fs.realpath(file)
        } catch (error) {
          diagnostics.push({
            kind,
            path: file,
            message: `Cannot resolve ${kind} artifact: ${skillFileErrorDetail(error)}`,
          })
          continue
        }
        if (!isPathWithin(state.canonicalRoot, canonicalFile)) {
          diagnostics.push({
            kind,
            path: file,
            message: `Refusing symlink escape outside plugin root: ${canonicalFile}`,
          })
          continue
        }
        out.push({ file: canonicalFile, name: [...prefix, base].join(':') })
      }
    }
  }
  await walk(root, [], explicit, 0)
  return out
}

/**
 * Resolve the `.md` files a Claude Code component field points at: the string path
 * entries in the manifest array (objects ignored) plus every `.md` under the default
 * `<dir>/<defaultSubdir>` — scanned RECURSIVELY so nested folders namespace into the
 * name (`commands/foo/bar.md` → `foo:bar`, full id `<plugin>:foo:bar`). Explicit `.md`
 * path entries keep their bare basename. All confined to the plugin directory; deduped
 * by name (first source wins: explicit entries before the default dir), name-sorted.
 *
 * `opts.replaceDefault` (CC spec REPLACE semantics): when true AND the field lists at
 * least one string path, the default `<dir>/<defaultSubdir>` is NOT scanned — the
 * manifest listing replaces the default, exactly as Claude Code does for `commands`
 * and `agents`. With no string paths the default scan still happens (an inline-object
 * only field never hides the default dir).
 */
export async function collectMarkdownFiles(
  dir: string,
  field: unknown[] | undefined,
  defaultSubdir: string,
  opts?: {
    replaceDefault?: boolean
    diagnostics?: PluginArtifactDiagnostic[]
    kind?: 'command' | 'agent'
  },
): Promise<CollectedMarkdownFile[]> {
  const diagnostics = opts?.diagnostics ?? []
  const kind = opts?.kind ?? (defaultSubdir === 'agents' ? 'agent' : 'command')
  let canonicalRoot: string
  try {
    canonicalRoot = await fs.realpath(dir)
  } catch (error) {
    diagnostics.push({
      kind,
      path: dir,
      message: `Cannot resolve plugin root: ${skillFileErrorDetail(error)}`,
    })
    return []
  }
  let pathEntries = asStringArray(field)
  if (pathEntries.length > MAX_CC_MARKDOWN_ROOTS) {
    diagnostics.push({
      kind,
      path: dir,
      message: `Markdown discovery uses the first ${MAX_CC_MARKDOWN_ROOTS} declared roots (received ${pathEntries.length})`,
    })
    pathEntries = pathEntries.slice(0, MAX_CC_MARKDOWN_ROOTS)
  }
  const paths = toAbsList(dir, pathEntries)
  // Keyed off the RESOLVED (safe) paths, not the raw entries — a manifest whose only
  // listed paths were dropped as unsafe (`..`, absolute) never hides the default dir.
  const skipDefault = opts?.replaceDefault === true && paths.length > 0
  // Explicit entries first (in declared order), then the default dir — so a name
  // declared explicitly wins over the same name discovered in the default scan.
  const explicitGroups = await mapLimit(paths, MAX_CONCURRENT_CC_MARKDOWN_ROOTS, async (abs) => {
    let canonical: string
    try {
      canonical = await fs.realpath(abs)
    } catch (error) {
      diagnostics.push({
        kind,
        path: abs,
        message: `Cannot read ${kind} artifact: ${skillFileErrorDetail(error)}`,
      })
      return []
    }
    if (!isPathWithin(canonicalRoot, canonical)) {
      diagnostics.push({
        kind,
        path: abs,
        message: `Refusing symlink escape outside plugin root: ${canonical}`,
      })
      return []
    }
    if (abs.endsWith('.md')) {
      try {
        const stat = await fs.stat(canonical)
        if (!stat.isFile()) {
          diagnostics.push({
            kind,
            path: abs,
            message: `${kind === 'command' ? 'Command' : 'Agent'} artifact is not a regular file`,
          })
          return []
        }
        return [{ file: canonical, name: basename(abs).replace(/\.md$/i, '') }]
      } catch (error) {
        diagnostics.push({
          kind,
          path: abs,
          message: `Cannot read ${kind} artifact: ${error instanceof Error ? error.message : 'unknown filesystem error'}`,
        })
        return []
      }
    }
    return scanDirCollect(canonical, kind, diagnostics, true, canonicalRoot)
  })
  const groups = [
    ...explicitGroups,
    ...(skipDefault
      ? []
      : [await scanDirCollect(join(dir, defaultSubdir), kind, diagnostics, false, canonicalRoot)]),
  ]
  const byName = new Map<string, CollectedMarkdownFile>()
  for (const group of groups) {
    for (const item of group) if (!byName.has(item.name)) byName.set(item.name, item)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Parse a Claude Code flat-file command (`commands/<name>.md`) into a PluginCommand.
 * The filename (sans `.md`) is the command name; YAML frontmatter `description` is
 * used if present; the markdown body becomes the prompt template. CC arg syntax
 * (`$ARGUMENTS`, `$1`) passes through verbatim — our dispatcher appends the user's
 * input when a prompt declares no `${argName}` placeholders.
 */
export async function parseCommandFile(
  file: string,
  nameOverride?: string,
  diagnostics?: PluginArtifactDiagnostic[],
): Promise<PluginCommand | null> {
  let raw: string
  try {
    raw = await readSkillMarkdownFile(file)
  } catch (error) {
    diagnostics?.push({
      kind: 'command',
      path: file,
      message: `Cannot read command artifact: ${skillFileErrorDetail(error)} (limit ${MAX_SKILL_MARKDOWN_BYTES} bytes)`,
    })
    return null
  }
  // Namespaced name from a nested `commands/foo/bar.md` scan when provided; else the
  // bare filename (top-level or explicit `.md` entry).
  const name = nameOverride ?? basename(file).replace(/\.md$/i, '')
  if (!PLUGIN_QUALIFIED_NAME_RE.test(name)) {
    diagnostics?.push({ kind: 'command', path: file, message: `Invalid command name "${name}"` })
    return null
  }
  const { fields, body } = parseMarkdownFrontmatter(raw)
  // CC compat: fold `when-to-use` (hyphen) and `when_to_use` (underscore) into description.
  // Both forms are accepted since different CC tools use both conventions.
  const description = [fields.description, fields['when-to-use'], fields.when_to_use]
    .filter(Boolean)
    .join(' ')
    .trim()
  if (!body) {
    diagnostics?.push({
      kind: 'command',
      path: file,
      message: 'Command artifact has no prompt body',
    })
    return null
  }
  const argumentHint = fields['argument-hint'] || undefined
  // CC `allowed-tools` / `disallowed-tools`: map CC names → engine names via CC_TOOL_NAME_MAP.
  const allowedTools = fields['allowed-tools'] ? mapCcTools(fields['allowed-tools']) : undefined
  const disallowedTools = fields['disallowed-tools']
    ? mapCcTools(fields['disallowed-tools'])
    : undefined
  // CC `model` — preferred model for this command's run (applied as a per-run override).
  const model = trimmedFrontmatterField(fields.model)
  // CC `disable-model-invocation` — user-invocable only (excluded from model listings).
  const disableModelInvocation = parseBooleanField(fields['disable-model-invocation'])
  const parsed = pluginCommandSchema.safeParse({
    name,
    description,
    args: [],
    prompt: body,
    ...(argumentHint ? { argumentHint } : {}),
    ...(allowedTools ? { allowedTools } : {}),
    ...(disallowedTools?.length ? { disallowedTools } : {}),
    ...(model ? { model } : {}),
    ...(disableModelInvocation ? { disableModelInvocation: true } : {}),
  })
  if (parsed.success) return parsed.data
  diagnostics?.push({
    kind: 'command',
    path: file,
    message: `Invalid command artifact: ${summarizeZodIssues(parsed.error).message}`,
  })
  return null
}

/** Coerce a YAML frontmatter scalar to a boolean (`true`/`yes`/`1` → true; unset/unknown → false). */
function parseBooleanField(value: string | string[] | undefined): boolean {
  return coerceFrontmatterBool(scalarField(value)) === true
}

/** True for a non-null, non-array object (a YAML mapping node). */
export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Translate a CC `tools` frontmatter value to engine tool names. Accepts
 * space/comma-separated strings and YAML inline arrays (`[Read, Bash]`).
 * Unknown CC tool names are dropped (dropUnknown policy).
 */
export function mapCcTools(rawValue: string | string[]): string[] {
  const tokens = splitTokenList(rawValue) ?? []
  return mapCcToolList(tokens, { dropUnknown: true })
}

/**
 * Map a CC tools field value to engine tool names, handling empty (`[]` = no tools).
 * Returns `undefined` when the field is absent or empty (→ inherit the role's default tool surface).
 * Returns `[]` only for an explicit YAML inline array `[]` (intentional no-tool surface).
 * Returns `undefined` when the list contains `*` (wildcard = all tools).
 */
function mapOptionalCcTools(raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  // Block-list path: already an array from parseMarkdownFrontmatter.
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [] // explicit empty list → no-tool surface
    if (raw.includes('*')) return undefined // wildcard → inherit default
    const mapped = mapCcTools(raw)
    return mapped.length > 0 ? mapped : undefined
  }
  const trimmed = raw.trim()
  if (trimmed === '') return undefined // empty/missing field → inherit default
  const stripped = trimmed.replace(/^\[|\]$/g, '').trim()
  if (stripped === '') return [] // explicit `[]` → no-tool surface
  // `*` or `["*"]` means "all tools" → inherit default.
  const tokens = splitTokenList(stripped) ?? []
  if (tokens.includes('*')) return undefined
  const mapped = mapCcTools(raw)
  return mapped.length > 0 ? mapped : undefined
}

/**
 * Parse a CC agent `.md` file into a PluginAgent worker role. Parses the COMPLETE
 * CC sub-agent frontmatter set (a stray/unknown value never aborts the parse):
 * `name`/`description`/`tools`/`disallowedTools`/`model`/`skills`/`effort` plus
 * `maxTurns`/`background`/`memory`/`isolation`/`color`/`initialPrompt`/`hooks`.
 * `mcpServers` + `permissionMode` are layered on at the registry level
 * (`agents/discovery.ts parseAgentRecordFile`).
 */
export async function parseAgentFile(
  file: string,
  nameOverride?: string,
  diagnostics?: PluginArtifactDiagnostic[],
): Promise<PluginAgent | null> {
  let raw: string
  try {
    raw = await readSkillMarkdownFile(file)
  } catch (error) {
    diagnostics?.push({
      kind: 'agent',
      path: file,
      message: `Cannot read agent artifact: ${skillFileErrorDetail(error)} (limit ${MAX_SKILL_MARKDOWN_BYTES} bytes)`,
    })
    return null
  }
  const { fields, body } = parseMarkdownFrontmatter(raw)
  // Namespacing: a nested `agents/nested/security.md` scans as `nested:security`. A
  // frontmatter `name` overrides the LEAF segment but keeps the subdir prefix, so
  // `nested/security.md` with `name: sec` → `nested:sec` (folder structure preserved).
  const scanName = nameOverride ?? basename(file).replace(/\.md$/i, '')
  // Docs, not agents: a `README.md` (any case) dropped into an agents dir is never
  // an agent definition — skip it before it can be coerced into one by its filename.
  const scanLeaf = scanName.split(':').pop() ?? scanName
  if (scanLeaf.toLowerCase() === 'readme') return null
  const prefix = scanName.split(':').slice(0, -1)
  const leaf = scalarField(fields.name)
  const name = leaf ? [...prefix, leaf].join(':') : scanName
  if (!PLUGIN_QUALIFIED_NAME_RE.test(name)) {
    diagnostics?.push({ kind: 'agent', path: file, message: `Invalid agent name "${name}"` })
    return null
  }
  if (!body) {
    diagnostics?.push({ kind: 'agent', path: file, message: 'Agent artifact has no prompt body' })
    return null
  }
  const tools = mapOptionalCcTools(fields.tools)
  const disallowedTools = mapOptionalCcTools(fields.disallowedTools)
  const preferredModel = trimmedFrontmatterField(fields.model)
  // CC `skills:` — skill names to preload when this agent runs.
  const pinnedSkillsRaw = splitTokenList(fields.skills)
  const pinnedSkills = pinnedSkillsRaw?.length ? pinnedSkillsRaw : undefined
  // CC `effort:` — preferred reasoning effort (advisory).
  const preferredEffort = trimmedFrontmatterField(fields.effort)
  // CC `maxTurns:` — cap the agent's turn count (enforced by the delegate runtime).
  const maxTurnsRaw = trimmedFrontmatterField(fields.maxTurns ?? fields.max_turns)
  const maxTurns =
    maxTurnsRaw && /^\d+$/.test(maxTurnsRaw) && Number(maxTurnsRaw) > 0
      ? Number(maxTurnsRaw)
      : undefined
  // CC `background:` — forces detached execution when the delegate host can safely
  // deliver the child's final result back to its parent session.
  const background = coerceFrontmatterBool(scalarField(fields.background))
  // CC `memory:` — persistent-memory scope (RECORDED only; see the contract field).
  const memoryRaw = trimmedFrontmatterField(fields.memory)
  const memory =
    memoryRaw === 'user' || memoryRaw === 'project' || memoryRaw === 'local' ? memoryRaw : undefined
  // CC `isolation:` — the external format has exactly one value, and it names a git mechanism. We
  // record what it MEANS, not what the file says: core does not know how a directory gets isolated.
  // This is the ONE place another tool's vocabulary is allowed to appear, because a parser has to
  // match the bytes on disk, and the ownership guard lists this file for exactly that reason.
  const isolation =
    trimmedFrontmatterField(fields.isolation) === 'worktree' ? ('isolated' as const) : undefined
  // CC `color:` — display color (persisted + surfaced to the runtime panel via delegate details).
  const color = trimmedFrontmatterField(fields.color)
  // CC `initialPrompt:` — main-session auto-first-turn (RECORDED only; no `--agent` mode here).
  const initialPrompt = trimmedFrontmatterField(fields.initialPrompt ?? fields.initial_prompt)
  // CC `hooks:` — sub-agent-scoped lifecycle hooks. Nested `{ Event: [{matcher?, hooks:[…]}] }`
  // maps are reached with a real YAML parse (the line-based .md parser skips nested blocks);
  // ACTIVATED for the child delegate run (see command-handlers / delegate wiring). A flat-string
  // `hooks:` value (rare) is ignored — only a mapping is a valid CC hooks block.
  const yaml = parseYamlFrontmatterBlock(raw)
  const hooks = isPlainRecord(yaml?.hooks) ? yaml!.hooks : undefined
  // CC `when-to-use:` (hyphen) and `when_to_use` (underscore) — appended to description.
  const desc =
    [fields.description, fields['when-to-use'], fields.when_to_use]
      .filter(Boolean)
      .join(' ')
      .trim() || ''
  // A real agent declares itself in frontmatter (CC requires `name` + `description`).
  // A file with NO agent frontmatter at all (neither a `name` nor a `description`) —
  // e.g. a plain markdown doc — must never be coerced into an agent by its filename.
  if (!leaf && !desc) return null
  const parsed = pluginAgentSchema.safeParse({
    name,
    description: desc,
    prompt: body,
    ...(tools !== undefined ? { tools } : {}),
    ...(disallowedTools?.length ? { disallowedTools } : {}),
    ...(preferredModel ? { preferredModel } : {}),
    ...(pinnedSkills ? { pinnedSkills } : {}),
    ...(preferredEffort ? { preferredEffort } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(background !== undefined ? { background } : {}),
    ...(memory ? { memory } : {}),
    ...(isolation ? { isolation } : {}),
    ...(color ? { color } : {}),
    ...(initialPrompt ? { initialPrompt } : {}),
    ...(hooks !== undefined ? { hooks } : {}),
  })
  if (parsed.success) return parsed.data
  diagnostics?.push({
    kind: 'agent',
    path: file,
    message: `Invalid agent artifact: ${summarizeZodIssues(parsed.error).message}`,
  })
  return null
}
