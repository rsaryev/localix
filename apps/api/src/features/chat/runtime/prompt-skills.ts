/**
 * Skills-listing assembly for the system prompt's "# Skills" section. Pure move
 * out of prompt-context.ts: given the discovered skills, the user's visibility
 * overrides, and the working dir, produce the bullet-list string the model sees
 * (or undefined when nothing is visible). No I/O.
 */

import { globToRegExpSource } from '../../cc-settings/permission-rules'
import { isSkillDisabled, type SkillOverrides } from '../../agent-core/skill-overrides'
import { skillCallName } from '../../agent-core/tools/skill-names'

/** Minimal shape of a skill entry needed to build its listing line. */
export interface SkillListingEntry {
  name: string
  /** The plugin that ships it: listed as Claude Code names it, `/<plugin>:<name>`. */
  pluginName?: string
  description?: string
  disableModelInvocation?: boolean
  /** CC `hide-from-slash-command-tool` — hidden from this listing, still user-invocable. */
  hideFromModel?: boolean
  activationPaths?: string[]
}

// One line per skill: the name is what the model retrieves by, the description says WHEN the
// skill applies. Claude Code truncates each entry's combined `description` + `when_to_use` at
// 1,536 characters, and its skills are written to that: the summary comes first and the trigger
// phrases ("Use when the user asks to …") after it. A shorter cut keeps the summary and drops the
// very words a request is matched against, so a skill written for Claude Code stops triggering.
const SKILL_DESC_MAX = 1536
// Total listing budget, about 1% of a 200k-token context window as Claude Code sizes its own.
// Past it, lines degrade to bare names before any skill is dropped, and `skill action="list"`
// still has every full description.
const SKILL_LISTING_BUDGET = 8000

function omittedSkillsNotice(count: number): string {
  return `[${count} additional skill${count === 1 ? '' : 's'} omitted: use the \`skill\` tool with action="list" to inspect the full roster.]`
}

interface RenderableSkillLine {
  full: string
  minimum: string
}

/**
 * Keep the roster inside its hard prompt budget and make loss observable. The old
 * subtraction loop appended the line *before* noticing it had exhausted the budget,
 * so one long description could overshoot by ~1.5k chars. It also silently hid every
 * later skill, which made a large installation look complete to the model.
 */
function renderMinimumSkillLines(allLines: readonly string[]): string {
  const included: string[] = []
  let used = 0

  for (const line of allLines) {
    const added = line.length + (included.length === 0 ? 0 : 1)
    if (used + added > SKILL_LISTING_BUDGET) break
    included.push(line)
    used += added
  }

  if (included.length === allLines.length) return included.join('\n')

  let omitted = allLines.length - included.length
  let notice = omittedSkillsNotice(omitted)
  while (included.length > 0 && used + 1 + notice.length > SKILL_LISTING_BUDGET) {
    const removed = included.pop()!
    used -= removed.length + (included.length === 0 ? 0 : 1)
    omitted += 1
    notice = omittedSkillsNotice(omitted)
  }

  return included.length > 0 ? `${included.join('\n')}\n${notice}` : notice
}

/**
 * Descriptions are optional metadata; names are the actionable index. Keep every
 * name visible whenever the minimum roster fits, spending the remaining budget
 * on full descriptions in stable discovery order. Degrading descriptions before
 * names prevents discovery order from becoming a hidden skill selector.
 */
function renderBudgetedSkillLines(entries: readonly RenderableSkillLine[]): string {
  const full = entries.map((entry) => entry.full)
  if (full.join('\n').length <= SKILL_LISTING_BUDGET) return full.join('\n')

  const minimum = entries.map((entry) => entry.minimum)
  if (minimum.join('\n').length > SKILL_LISTING_BUDGET) {
    return renderMinimumSkillLines(minimum)
  }

  const lines: string[] = []
  let used = 0
  const suffixMinimumCost = Array.from<number>({ length: entries.length + 1 }).fill(0)
  for (let i = entries.length - 1; i >= 0; i--) {
    suffixMinimumCost[i] = suffixMinimumCost[i + 1] + 1 + minimum[i].length
  }
  for (let i = 0; i < entries.length; i++) {
    const separator = i === 0 ? 0 : 1
    const candidate = entries[i].full
    const selected =
      used + separator + candidate.length + suffixMinimumCost[i + 1] <= SKILL_LISTING_BUDGET
        ? candidate
        : entries[i].minimum
    lines.push(selected)
    used += separator + selected.length
  }
  return lines.join('\n')
}

/**
 * True when `cwd` matches at least one of the skill's CC `paths` glob patterns.
 *
 * Compiled by the canonical `globToRegExpSource` rather than by hand. The hand-rolled
 * version translated `*`/`**` and passed EVERYTHING ELSE into the regex verbatim — but
 * `paths:` is free text from a skill author's frontmatter, and real directories carry
 * `.`, `-`, `+`, `(`. So `apps/my.app` matched `apps/myXapp`, and `src/(old` threw a
 * SyntaxError that the catch below turned into "no match" — silently dropping the skill
 * from the model's listing in the very repo it was scoped to. Neither failure said
 * anything; the author would go looking at their frontmatter.
 */
function cwdMatchesActivationPaths(activationPaths: string[], defaultCwd: string): boolean {
  const cwd = defaultCwd.replace(/\\/g, '/')
  return activationPaths.some((pat) => {
    try {
      return new RegExp(`(^|/)${globToRegExpSource(pat.replace(/\\/g, '/'))}(/|$)`).test(cwd)
    } catch {
      return false
    }
  })
}

export function buildSkillsContext(
  allSkills: readonly SkillListingEntry[],
  // Takes the shared `SkillOverrides` shape rather than a bare record: a missing key and a
  // key holding `undefined` mean the same thing here, and the two spellings used to need a
  // cast at every call site.
  skillOverrides: SkillOverrides,
  defaultCwd: string,
  /** Call names of `paths:`-scoped skills a touched file activates (`prompt-skill-paths.ts`). */
  activatedByProjectFiles: ReadonlySet<string> = new Set(),
): string | undefined {
  const skillLineByName = new Map<string, RenderableSkillLine>()
  for (const f of allSkills) {
    // Apply skillOverrides first (user settings win over frontmatter).
    if (isSkillDisabled(skillOverrides, f.name)) continue
    // frontmatter-level hide: both `disable-model-invocation` and
    // `hide-from-slash-command-tool` remove the entry from the model listing.
    if (f.disableModelInvocation || f.hideFromModel) continue
    // Keyed and shown by the name it is called by: two plugins' `lookup` are two skills.
    const called = skillCallName(f)
    // CC `paths` — offered once a file it matches is worked with, or the working directory matches.
    if (
      f.activationPaths?.length &&
      !activatedByProjectFiles.has(called) &&
      !cwdMatchesActivationPaths(f.activationPaths, defaultCwd)
    ) {
      continue
    }
    if (!skillLineByName.has(called)) {
      const desc = (f.description || 'Skill').slice(0, SKILL_DESC_MAX)
      const minimum = `- /${called}`
      skillLineByName.set(called, {
        full: desc ? `${minimum}: ${desc}` : minimum,
        minimum,
      })
    }
  }

  if (skillLineByName.size === 0) return undefined
  return renderBudgetedSkillLines([...skillLineByName.values()])
}
