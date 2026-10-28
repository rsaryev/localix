import { DECLARABLE_EFFORTS_TEXT, isDeclarableEffort } from '../../db/types'
import { frontmatterBool } from './frontmatter-values'
import { basename, dirname } from 'node:path'

import { parseMarkdownFrontmatter, scalarField, splitTokenList } from './skill-discovery'
import { readSkillMarkdownFile, skillFileErrorDetail } from './skill-file'

/**
 * Pure per-`SKILL.md` validation — the skill-domain counterpart of the plugin
 * manifest validator. Lives in agent-core (the home of skill parsing) so every
 * consumer can share it: the plugin subsystem folds it over bundled skills
 * (`plugins/validate-skill.ts` → `validatePluginSkills`) and the skills settings
 * surface attaches it to each filesystem skill (`chat/service/skill-ops.ts`).
 * It depends on nothing outside agent-core.
 */

/** Skill validation outcome — structurally identical to a plugin's `{errors,warnings}`. */
export interface SkillValidation {
  errors: string[]
  warnings: string[]
}

/**
 * Validate a single SKILL.md. Only hard errors (unreadable file, no body at all
 * without any description to fall back on) block the skill. CC spec parity:
 * `name` is optional (dir basename is the fallback), `description` is optional
 * (first body line is extracted at load time).
 */
export async function validateSkillFile(skillMdPath: string): Promise<SkillValidation> {
  const errors: string[] = []
  const warnings: string[] = []

  let raw: string
  try {
    raw = await readSkillMarkdownFile(skillMdPath)
  } catch (error) {
    errors.push(`Cannot read skill file: ${skillMdPath} (${skillFileErrorDetail(error)})`)
    return { errors, warnings }
  }

  const { fields, body } = parseMarkdownFrontmatter(raw)
  const name = scalarField(fields.name)
  // Accept both `description` and `when_to_use`/`when-to-use` as the skill description source.
  const description = fields.description || fields.when_to_use || fields['when-to-use']
  const dirName = basename(dirname(skillMdPath))

  // `name` is optional — the runtime falls back to the dir basename. Warn so the
  // author knows, but don't block. Errors only on truly broken files.
  if (!name)
    warnings.push(
      `Skill "${dirName}" has no frontmatter "name" — the directory name "${dirName}" will be used.`,
    )
  // Description is optional too — the runtime extracts the first body line.
  if (!description && !body)
    errors.push(`Skill "${dirName}" is missing both frontmatter "description" and a body.`)
  else if (!description)
    warnings.push(
      `Skill "${dirName}" has no frontmatter "description" — the first body line will be used.`,
    )
  if (!body) warnings.push(`Skill "${dirName}" has an empty body.`)
  if (name && name !== dirName) {
    warnings.push(`Skill frontmatter name "${name}" doesn't match its directory "${dirName}".`)
  }
  // `context:` only accepts `fork` — warn on any other value.
  const context = scalarField(fields.context)
  if (context && context.trim() !== 'fork') {
    warnings.push(
      `Skill "${dirName}" has an unrecognized "context" value "${context.trim()}" — the only accepted value is "fork".`,
    )
  }
  // CC warns: `context: fork` only makes sense for skills with explicit task-body instructions.
  // A guidelines-only body without an actionable task leaves the subagent without a prompt.
  if (fields.context === 'fork' && body && body.trim().length < 20) {
    warnings.push(
      `Skill "${dirName}" has "context: fork" but a very short body — the forked sub-agent needs explicit task instructions, not just short guidelines.`,
    )
  }
  // `user-invocable: false` + `disable-model-invocation: true` = no way to invoke the skill.
  const disableModel = frontmatterBool(fields['disable-model-invocation']) === true
  const notUserInvocable = frontmatterBool(fields['user-invocable']) === false
  if (disableModel && notUserInvocable) {
    warnings.push(
      `Skill "${dirName}" has both "disable-model-invocation: true" and "user-invocable: false" — neither Claude nor users can invoke it, making it dead code.`,
    )
  }
  // `agent:` (subagent type for fork) only makes sense alongside `context: fork`.
  if (fields.agent && fields.context !== 'fork') {
    warnings.push(
      `Skill "${dirName}" declares "agent: ${scalarField(fields.agent) ?? ''}" but no "context: fork" — the "agent:" field is only used when "context: fork" is also set.`,
    )
  }
  // `allowed-tools: *` is redundant — the default surface already allows all tools.
  // `allowed-tools: []` is also redundant — empty list = nothing auto-approved = default.
  if (fields['allowed-tools']) {
    const raw = (scalarField(fields['allowed-tools']) ?? '').trim()
    if (raw === '*') {
      warnings.push(
        `Skill "${dirName}" has "allowed-tools: *" which is the default — remove this field since all tools are allowed without it.`,
      )
    } else if (raw === '[]' || raw === '') {
      warnings.push(
        `Skill "${dirName}" has an empty "allowed-tools:" — this is the default behavior; remove it to reduce frontmatter clutter.`,
      )
    }
  }
  // `disallowed-tools: *` blocks all tools, making the skill unable to do anything.
  if (
    fields['disallowed-tools'] &&
    (scalarField(fields['disallowed-tools']) ?? '').trim() === '*'
  ) {
    warnings.push(
      `Skill "${dirName}" has "disallowed-tools: *" which blocks all tools — the skill can't do anything useful. Use specific tool names to block only what's needed.`,
    )
  }
  // `allowed-tools` and `disallowed-tools` overlap — a tool in both is confusing.
  if (fields['allowed-tools'] && fields['disallowed-tools']) {
    const allowed = new Set(
      (splitTokenList(fields['allowed-tools']) ?? []).map((t) => t.toLowerCase()),
    )
    const disallowed = splitTokenList(fields['disallowed-tools']) ?? []
    for (const tool of disallowed) {
      if (allowed.has(tool.toLowerCase())) {
        warnings.push(
          `Skill "${dirName}" has "${tool}" in both "allowed-tools" and "disallowed-tools" — this is contradictory; disallowedTools takes precedence.`,
        )
      }
    }
  }
  // `paths:` activation patterns — absolute or traversal paths cause issues.
  if (fields.paths) {
    const pathVals = (scalarField(fields.paths) ?? '').split(/[\s,]+/).filter(Boolean)
    for (const p of pathVals) {
      if (p.startsWith('/') || /^[A-Za-z]:\\/.test(p)) {
        warnings.push(
          `Skill "${dirName}" has an absolute "paths:" pattern "${p}" — use relative glob patterns (e.g. "src/**/*.ts") that match against the session working directory.`,
        )
      } else if (p.includes('..')) {
        warnings.push(
          `Skill "${dirName}" has a "paths:" pattern "${p}" containing ".." — path traversal patterns are not recommended and may not match as expected.`,
        )
      }
    }
  }
  // `effort:` must be a recognized level — same check as for agent roles.
  const effort = scalarField(fields.effort)
  if (effort && !isDeclarableEffort(effort.trim())) {
    warnings.push(
      `Skill "${dirName}" has an unrecognized "effort" value "${effort.trim()}" — valid values: ${DECLARABLE_EFFORTS_TEXT}.`,
    )
  }
  // `arguments:` names shouldn't conflict with CC reserved tokens ($ARGUMENTS, $0, etc.)
  // or built-in env vars — those would be silently overridden at substitution time.
  // Numeric-only names (0, 1, …) are dropped by the runtime (conflict with $0/$1 shorthand).
  if (fields.arguments) {
    const RESERVED = new Set([
      'ARGUMENTS',
      'CLAUDE_SESSION_ID',
      'CLAUDE_EFFORT',
      'CLAUDE_SKILL_DIR',
      'CLAUDE_PROJECT_DIR',
    ])
    const argNames = (scalarField(fields.arguments) ?? '').split(/[\s,]+/).filter(Boolean)
    for (const argName of argNames) {
      if (/^\d+$/.test(argName)) {
        warnings.push(
          `Skill "${dirName}" uses numeric-only name "${argName}" in "arguments:" — it conflicts with the $${argName} positional shorthand and will be silently dropped.`,
        )
      } else if (RESERVED.has(argName.toUpperCase())) {
        warnings.push(
          `Skill "${dirName}" uses "${argName}" as an argument name, which conflicts with the reserved substitution token $${argName.toUpperCase()}.`,
        )
      }
    }
  }

  return { errors, warnings }
}
