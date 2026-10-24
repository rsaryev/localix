/**
 * What a `SKILL.md` MEANS: the mapping from parsed frontmatter fields to a
 * `DiscoveredSkill`, and back out again when one is written.
 *
 * How frontmatter parses, and how one of its values splits into a list, is a different
 * subject and lives in `frontmatter-values.ts` — nothing there knows what a skill is. No
 * filesystem access lives in either; `skill-discovery.ts` owns the fs walk + CRUD and
 * composes both, re-exporting the public parsers for existing importers.
 */
import { parseYamlFrontmatterBlock, renderFrontmatterFile } from './frontmatter-yaml'
import {
  frontmatterBool,
  parseMarkdownFrontmatter,
  splitPhraseList,
  splitTokenList,
} from './frontmatter-values'

export { parseMarkdownFrontmatter, splitPhraseList, splitTokenList }

export interface DiscoveredSkill {
  // ---- Core fields -------------------------------------------------------
  name: string
  description: string
  content: string
  scope: 'project' | 'global'
  path: string // absolute path to SKILL.md
  dir: string // absolute path to the skill directory (may contain scripts)
  /**
   * The plugin that shipped this skill, when one did.
   *
   * Attribution rather than decoration: a plugin is loaded once per SCOPE and shared by every
   * agent in it, so subtracting the plugins ONE agent may not use needs to know which items
   * came from which plugin. A path prefix would answer for the skills we ship today and stop
   * answering the moment a plugin reads a skill from outside its own directory.
   */
  pluginName?: string
  /** That plugin's directory: `${CLAUDE_PLUGIN_ROOT}` for the skill's commands and hooks. */
  pluginRoot?: string
  /** That plugin's `${CLAUDE_PLUGIN_DATA}`, keyed by its identifier (`name@marketplace`). */
  pluginDataDir?: string
  // ---- CC-compatible frontmatter fields ----------------------------------
  // All optional. Parsed from SKILL.md frontmatter by parseSkillFrontmatter.

  /** `disable-model-invocation: true` — excluded from model listing; still user-invocable. */
  disableModelInvocation?: boolean
  /** `user-invocable: false` — model-only; blocks direct `/name` slash invocations. */
  userInvocable?: boolean
  /** `argument-hint: "[env]"` — composer placeholder when this skill is selected. */
  argumentHint?: string
  /** `arguments: issue branch` — ordered names for `$name` positional substitution. */
  argumentNames?: string[]
  /** `allowed-tools: Bash(git *)` — auto-approved tools during the skill run. */
  allowedTools?: string[]
  /** `disallowed-tools: Write Edit` — tools removed from the pool during the skill run. */
  disallowedTools?: string[]
  /** `paths: src/**` — exclude from auto-listing when session cwd doesn't match any pattern. */
  activationPaths?: string[]
  /**
   * `keywords: deploy to prod, rollback` — phrases that FORCE this skill's content into the
   * prompt when the user's own message contains one, instead of leaving retrieval to the
   * model's judgement. Comma-separated, so a phrase may contain spaces.
   */
  keywords?: string[]
  /** `context: fork` — run in an isolated sub-agent instead of inline. */
  contextFork?: boolean
  /** `agent: Explore` — subagent type for `context: fork`. */
  forkAgent?: string
  /** `background: false` — a `context: fork` skill's caller waits for its result (CC default: true). */
  forkBackground?: boolean
  /** `model: sonnet` — preferred model hint (advisory). */
  preferredModel?: string
  /** `effort: high` — preferred reasoning effort hint (advisory). */
  preferredEffort?: string
  /** `version:` — skill version string (informational, used for tracking updates). */
  version?: string
  /**
   * `hide-from-slash-command-tool: true` — hide from the MODEL's skill listing
   * (same effect as `disable-model-invocation` for listing purposes) while keeping
   * the skill user-invocable via `/name`. Like `disableModelInvocation`, this only
   * controls implicit/model selection; an explicit slash invocation or pin still
   * loads the skill.
   */
  hideFromModel?: boolean
  /**
   * `shell: bash | powershell` — shell used for `` !`cmd` `` / ```` ```! ```` blocks.
   * `bash` (default) runs via `sh -c`; `powershell` is unsupported off-Windows and
   * falls back to bash. Parsed for tolerance + future use.
   */
  shell?: string
  /** `license:` — open-standard (agentskills.io) field. Parsed + retained; ignored at runtime. */
  license?: string
  /**
   * `hooks:` — CC-format skill-scoped lifecycle hooks (a `{ Event: [{matcher?, hooks:[…]}] }`
   * map). Stored RAW (agent-core stays chat-agnostic — it never runs a hook). The chat
   * command dispatcher activates them for the skill's run window (see `command-handlers.ts`).
   * Extracted with a real YAML parse (`frontmatter-yaml.ts`) since the block is nested.
   */
  hooks?: unknown
}

/** Parsed SKILL.md frontmatter — name/description/body + all CC-compat optional fields. */
export type SkillFrontmatter = {
  name?: string
  description?: string
  body: string
  version?: string
} & Omit<DiscoveredSkill, 'name' | 'description' | 'content' | 'scope' | 'path' | 'dir' | 'version'>

/**
 * Extract a short description from the skill body when no frontmatter description exists.
 * Uses the first non-empty line (strips Markdown headers). Mirrors CC behavior.
 */
function extractBodyDescription(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || /^[-*_]{3,}$/.test(trimmed)) continue // skip blank lines and HR markers
    const text = trimmed.replace(/^#+\s+/, '') // strip markdown header markers
    if (!text) continue
    return text.length > 100 ? text.slice(0, 97) + '...' : text
  }
  return undefined
}

/**
 * Coerce a frontmatter field value to a plain string.
 * Block-list arrays (unexpected on scalar fields) are joined with a space
 * so the caller's existing string logic continues to work unchanged.
 */
export function scalarField(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined
  return Array.isArray(v) ? v.join(' ') : v
}

/**
 * An `argument-hint`, written as the author meant it: unquoted `[name]` parses as a YAML flow
 * list, and Claude Code's own plugins write it that way, so a list is put back in its brackets.
 */
export function argumentHintField(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined
  const hint = Array.isArray(v) ? `[${v.join(', ')}]` : v
  return hint.trim() || undefined
}

/** True for a non-null, non-array object (a YAML mapping node). */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse a SKILL.md raw string into all CC-compatible frontmatter fields + body. */
export function parseSkillFrontmatter(raw: string): SkillFrontmatter {
  const { fields, body } = parseMarkdownFrontmatter(raw)
  // Nested `hooks:` can only be reached with a real YAML parse (the flat parser
  // skips nested blocks). On malformed YAML the block parse returns undefined and
  // `hooks` is simply absent — the flat scalar/list fields above stay authoritative.
  const yaml = parseYamlFrontmatterBlock(raw)
  const hooks = isPlainRecord(yaml?.hooks) ? yaml!.hooks : undefined
  // `when_to_use` (underscore) and `when-to-use` (hyphen) both accepted for CC compat.
  // Appended to description so ported CC skills keep triggering on their phrases.
  // When neither is set, extract the first meaningful line from the body.
  const explicitDesc = [
    scalarField(fields.description),
    scalarField(fields.when_to_use),
    scalarField(fields['when-to-use']),
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
  const description = explicitDesc || extractBodyDescription(body)
  // Booleans read as Claude Code reads them: true/yes/on/1 and false/no/off/0, any case.
  const disableModelInvocation = frontmatterBool(fields['disable-model-invocation']) || undefined
  // CC `hide-from-slash-command-tool` — hides from the model listing but keeps the skill
  // user-invocable (see DiscoveredSkill.hideFromModel).
  const hideFromModel = frontmatterBool(fields['hide-from-slash-command-tool']) || undefined
  const userInvocable = frontmatterBool(fields['user-invocable'])
  return {
    name: scalarField(fields.name) || undefined,
    description,
    body,
    disableModelInvocation,
    userInvocable,
    argumentHint: argumentHintField(fields['argument-hint']),
    // CC: filter numeric-only names (conflict with $0/$1 positional shorthand).
    argumentNames: splitTokenList(fields.arguments)?.filter((n) => !/^\d+$/.test(n)) || undefined,
    allowedTools: splitTokenList(fields['allowed-tools']),
    disallowedTools: splitTokenList(fields['disallowed-tools']),
    activationPaths: splitTokenList(fields.paths),
    keywords: splitPhraseList(fields.keywords),
    contextFork: scalarField(fields.context) === 'fork' || undefined,
    forkAgent: scalarField(fields.agent) || undefined,
    forkBackground: frontmatterBool(fields.background),
    preferredModel: scalarField(fields.model) || undefined,
    preferredEffort: scalarField(fields.effort) || undefined,
    version: scalarField(fields.version) || undefined,
    hideFromModel,
    shell: scalarField(fields.shell) || undefined,
    license: scalarField(fields.license) || undefined,
    hooks,
    // NOTE: `metadata` (arbitrary open-standard map) is intentionally not surfaced —
    // parseMarkdownFrontmatter tolerates it (nested map lines are ignored), so it
    // never breaks parsing; we simply don't carry it onto DiscoveredSkill.
  }
}

/**
 * Render a complete SKILL.md. `name`/`description`/body come from the caller; every OTHER
 * frontmatter key in `existingRaw` — including keys this codebase does not model (`license`,
 * `metadata`, a vendor `x-*`) — is kept with its comments, because the file, not our type, owns
 * that knowledge (`renderFrontmatterFile`). Pass `''` for a brand-new skill.
 */
export function renderSkillFile(
  existingRaw: string,
  input: { name: string; description: string; content: string },
): string {
  // Collapse whitespace (newlines, tabs) to single space — the description is one line.
  const description = input.description.replace(/[\r\n\t]+/g, ' ').trim()
  return renderFrontmatterFile(existingRaw, { name: input.name, description }, input.content.trim())
}

/** Build a DiscoveredSkill from parsed frontmatter + filesystem coords. */
export function makeSkill(
  fm: SkillFrontmatter,
  fallbackName: string,
  scope: 'project' | 'global',
  path: string,
  dir: string,
): DiscoveredSkill {
  const { name, description, body, ...ccFields } = fm
  // Collect only the truthy CC fields — undefined/false/empty-array are omitted.
  const cc: Partial<DiscoveredSkill> = {}
  if (ccFields.disableModelInvocation) cc.disableModelInvocation = true
  if (ccFields.userInvocable === false) cc.userInvocable = false
  if (ccFields.argumentHint) cc.argumentHint = ccFields.argumentHint
  if (ccFields.argumentNames?.length) cc.argumentNames = ccFields.argumentNames
  if (ccFields.allowedTools?.length) cc.allowedTools = ccFields.allowedTools
  if (ccFields.disallowedTools?.length) cc.disallowedTools = ccFields.disallowedTools
  if (ccFields.activationPaths?.length) cc.activationPaths = ccFields.activationPaths
  if (ccFields.keywords?.length) cc.keywords = ccFields.keywords
  if (ccFields.contextFork) cc.contextFork = true
  if (ccFields.forkAgent) cc.forkAgent = ccFields.forkAgent
  if (ccFields.forkBackground === false) cc.forkBackground = false
  if (ccFields.preferredModel) cc.preferredModel = ccFields.preferredModel
  if (ccFields.preferredEffort) cc.preferredEffort = ccFields.preferredEffort
  if (ccFields.version) cc.version = ccFields.version
  if (ccFields.hideFromModel) cc.hideFromModel = true
  if (ccFields.shell) cc.shell = ccFields.shell
  if (ccFields.license) cc.license = ccFields.license
  if (ccFields.hooks !== undefined) cc.hooks = ccFields.hooks
  return {
    name: name || fallbackName,
    description: description || '',
    content: body,
    scope,
    path,
    dir,
    ...cc,
  }
}
