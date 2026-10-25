import { basename } from 'node:path'

import { schemaIssue } from './contracts-base'

import { mapCcRuleList, mapCcToolList } from '../ext/cc-tool-names'
import { coerceFrontmatterBool, trimmedFrontmatterField } from '../ext/frontmatter'
import { argumentHintField } from '../agent-core/skill-frontmatter'
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
  localixKeySchema,
  pluginAgentSchema,
  pluginCommandSchema,
  type PluginAgent,
  type PluginCommand,
} from './contracts'
import type { PluginArtifactDiagnostic } from './discovery-entrypoints'
import { agentHandleSegment, isValidCcAgentName, preloadedSkills } from './agent-names'

/**
 * Claude Code flat-file (`commands/*.md`, `agents/*.md`) discovery + parsing,
 * split out of discovery.ts. These resolve and parse CC-convention markdown files
 * into PluginCommand/PluginAgent objects. Re-exported from discovery.ts so the
 * loader path is unchanged.
 */

export { collectMarkdownFiles, type CollectedMarkdownFile } from './discovery-cc-markdown-scan'

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
  const argumentHint = argumentHintField(fields['argument-hint'])
  // CC `arguments` — names for positional arguments (`$name` in the prompt).
  const argumentNames = fields.arguments
    ? (splitTokenList(fields.arguments) ?? []).filter((name) => !/^\d+$/.test(name))
    : []
  // CC `allowed-tools` / `disallowed-tools`: map CC names → engine names via CC_TOOL_NAME_MAP. An
  // allowed `Bash(git add:*)` keeps its pattern: it pre-approves that command, not the shell.
  const allowedTools = fields['allowed-tools']
    ? mapCcRuleList(splitTokenList(fields['allowed-tools']) ?? [])
    : undefined
  const disallowedTools = fields['disallowed-tools']
    ? mapCcRuleList(splitTokenList(fields['disallowed-tools']) ?? []) // keeps `Bash(rm *)`
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
    ...(argumentNames.length ? { arguments: argumentNames } : {}),
    ...(allowedTools ? { allowedTools } : {}),
    ...(disallowedTools?.length ? { disallowedTools } : {}),
    ...(model ? { model } : {}),
    ...(disableModelInvocation ? { disableModelInvocation: true } : {}),
  })
  if (parsed.success) return parsed.data
  diagnostics?.push({
    kind: 'command',
    path: file,
    message: `Invalid command artifact: ${schemaIssue(parsed.error)}`,
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
 * The types `Agent(worker, researcher)` in a `tools` list names (sub-agents.md): an allowlist of the
 * agents the main thread may spawn. A bare `Agent` or `Task` allows every type, so the list is then
 * absent; with typed entries only the named types are allowed.
 */
export function delegableAgentTypes(raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const types: string[] = []
  for (const token of splitTokenList(raw) ?? []) {
    const typed = /^(?:agent|task)\((.*)\)$/is.exec(token.trim())
    if (typed) types.push(...(splitTokenList(typed[1]!.replace(/,/g, ' ')) ?? []))
  }
  return types.length ? [...new Set(types)] : undefined
}

/**
 * Map a CC tools field value to engine tool names, handling empty (`[]` = no tools).
 * Returns `undefined` when the field is absent or empty (→ inherit the role's default tool surface).
 * Returns `[]` only for an explicit YAML inline array `[]` (intentional no-tool surface).
 * Returns `undefined` when the list contains `*` (wildcard = all tools).
 * A list whose every name is unknown here (`TodoWrite`, `ExitPlanMode`) maps to `[]`: a `tools`
 * list is exact, so dropping its names must not widen it to the inherited surface.
 */
function mapOptionalCcTools(raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  // Block-list path: already an array from parseMarkdownFrontmatter.
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [] // explicit empty list → no-tool surface
    if (raw.includes('*')) return undefined // wildcard → inherit default
    return mapCcTools(raw)
  }
  const trimmed = raw.trim()
  if (trimmed === '') return undefined // empty/missing field → inherit default
  const stripped = trimmed.replace(/^\[|\]$/g, '').trim()
  if (stripped === '') return [] // explicit `[]` → no-tool surface
  // `*` or `["*"]` means "all tools" → inherit default.
  const tokens = splitTokenList(stripped) ?? []
  if (tokens.includes('*')) return undefined
  return mapCcTools(raw)
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
  const parsedMarkdown = parseMarkdownFrontmatter(raw)
  const { body } = parsedMarkdown
  // CC: frontmatter that does not parse leaves the agent loading with every field ignored.
  const yaml = parseYamlFrontmatterBlock(raw)
  const unparsable = /^---\r?\n/.test(raw) && yaml === undefined
  const fields: typeof parsedMarkdown.fields = unparsable ? {} : parsedMarkdown.fields
  // Namespacing: a nested `agents/nested/security.md` scans as `nested:security`. A
  // frontmatter `name` overrides the LEAF segment but keeps the subdir prefix, so
  // `nested/security.md` with `name: sec` → `nested:sec` (folder structure preserved).
  const scanName = nameOverride ?? basename(file).replace(/\.md$/i, '')
  const prefix = scanName.split(':').slice(0, -1)
  // CC ignores a `name` it cannot use (over 256 characters, a leading `-`) and names the agent
  // after its file; any other name is valid there and reaches Localix as a safe handle. A `:` in
  // a plugin's name keeps reading as namespacing, so `validatePlugin` can say it repeats the prefix
  // (a user's or project's file with a `:` never gets here: `readAgentFile` skips it, as CC does).
  const named = scalarField(fields.name)?.trim()
  const leaf = named && isValidCcAgentName(named, { namespaced: true }) ? named : undefined
  const name = [...prefix, ...(leaf ?? scanName.split(':').pop() ?? scanName).split(':')]
    .map(agentHandleSegment)
    .join(':')
  if (!PLUGIN_QUALIFIED_NAME_RE.test(name)) {
    diagnostics?.push({ kind: 'agent', path: file, message: `Invalid agent name "${name}"` })
    return null
  }
  if (!body) {
    diagnostics?.push({ kind: 'agent', path: file, message: 'Agent artifact has no prompt body' })
    return null
  }
  const tools = mapOptionalCcTools(fields.tools)
  // A deny list that names nothing known here denies nothing. An entry with a specifier
  // (`Bash(rm *)`) keeps it: the run denies those calls and leaves the tool.
  const deniedTools = fields.disallowedTools
    ? mapCcRuleList(splitTokenList(fields.disallowedTools) ?? [])
    : undefined
  const disallowedTools = deniedTools?.length ? deniedTools : undefined
  const agentTypes = delegableAgentTypes(fields.tools)
  const preferredModel = trimmedFrontmatterField(fields.model)
  // CC `skills:` — skill names to preload when this agent runs.
  const pinnedSkillsRaw = preloadedSkills(splitTokenList(fields.skills))
  const pinnedSkills = pinnedSkillsRaw.length ? pinnedSkillsRaw : undefined
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
  // CC `omitClaudeMd:` — run without the workspace instruction files.
  const omitClaudeMd = coerceFrontmatterBool(scalarField(fields.omitClaudeMd)) === true
  // CC `autoCompactWindow:` — the window its runs compact against, 100000–1000000 tokens.
  const windowRaw = Number(trimmedFrontmatterField(fields.autoCompactWindow) ?? Number.NaN)
  const autoCompactWindow =
    Number.isInteger(windowRaw) && windowRaw >= 100_000 && windowRaw <= 1_000_000
      ? windowRaw
      : undefined
  // CC `color:` — display color (persisted + surfaced to the runtime panel via delegate details).
  const color = trimmedFrontmatterField(fields.color)
  // CC `initialPrompt:` — main-session auto-first-turn (RECORDED only; no `--agent` mode here).
  const initialPrompt = trimmedFrontmatterField(fields.initialPrompt ?? fields.initial_prompt)
  // CC `hooks:` — sub-agent-scoped lifecycle hooks. Nested `{ Event: [{matcher?, hooks:[…]}] }`
  // maps are reached with a real YAML parse (the line-based .md parser skips nested blocks);
  // ACTIVATED for the child delegate run (see command-handlers / delegate wiring). A flat-string
  // `hooks:` value (rare) is ignored — only a mapping is a valid CC hooks block.
  const hooks = isPlainRecord(yaml?.hooks) ? yaml!.hooks : undefined
  // CC `mcpServers:` — a list of server names and/or `{ name: definition }` maps.
  const mcpServers = Array.isArray(yaml?.mcpServers) ? yaml!.mcpServers : undefined
  // `localix:` — what Claude Code has no place for; Claude Code ignores the key.
  const localix = isPlainRecord(yaml?.localix) ? localixKeySchema.safeParse(yaml!.localix) : null
  // CC `experimental.cacheTtl:` — `5m` or `1h`; any other value is ignored.
  const ttl = isPlainRecord(yaml?.experimental) ? yaml!.experimental.cacheTtl : undefined
  const cacheTtl = ttl === '5m' || ttl === '1h' ? ttl : undefined
  // An agent has no `when_to_use` (sub-agents.md): `description` alone says when to delegate.
  const desc = scalarField(fields.description)?.trim() ?? ''
  // CC loads a file with no frontmatter too, named after the file; the loader gives it the
  // description `Agent from <plugin> plugin` (`manifest-load.ts`).
  const parsed = pluginAgentSchema.safeParse({
    name,
    description: desc,
    prompt: body,
    ...(tools !== undefined ? { tools } : {}),
    ...(disallowedTools?.length ? { disallowedTools } : {}),
    ...(agentTypes ? { agentTypes } : {}),
    ...(preferredModel ? { preferredModel } : {}),
    ...(pinnedSkills ? { pinnedSkills } : {}),
    ...(preferredEffort ? { preferredEffort } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(background !== undefined ? { background } : {}),
    ...(memory ? { memory } : {}),
    ...(autoCompactWindow ? { autoCompactWindow } : {}),
    ...(isolation ? { isolation } : {}),
    ...(omitClaudeMd ? { omitClaudeMd } : {}),
    ...(cacheTtl ? { cacheTtl } : {}),
    ...(color ? { color } : {}),
    ...(initialPrompt ? { initialPrompt } : {}),
    ...(hooks !== undefined ? { hooks } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(localix?.success ? { localix: localix.data } : {}),
  })
  if (parsed.success) return parsed.data
  diagnostics?.push({
    kind: 'agent',
    path: file,
    message: `Invalid agent artifact: ${schemaIssue(parsed.error)}`,
  })
  return null
}
