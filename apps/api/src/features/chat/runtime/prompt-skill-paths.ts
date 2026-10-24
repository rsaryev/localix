/**
 * Which `paths:`-scoped skills the working directory activates.
 *
 * Claude Code reads a skill's `paths` as globs over FILES, relative to the working directory, and
 * offers the skill once the model works with a matching one. Localix assembles the roster once per
 * run, not per file touched, so it applies the rule it already applies to path-scoped rules
 * (`agent-core/context-rules.ts`): a skill is offered when the project holds a file its globs
 * match. The cwd-as-path match in `prompt-skills.ts` stays for skills written against directories.
 *
 * The scan stops at the first hit, skips dot-directories, and is remembered per working directory
 * and pattern for a short while, so a roster rebuilt every turn does not walk the tree every turn.
 */
import { skillCallName } from '../../agent-core/tools/skill-names'
import type { SkillListingEntry } from './prompt-skills'

const MEMO_TTL_MS = 60_000
const memo = new Map<string, { at: number; hit: Promise<boolean> }>()

async function anyFileMatches(pattern: string, cwd: string): Promise<boolean> {
  try {
    const glob = new Bun.Glob(pattern.replace(/\\/g, '/').replace(/^\.\//, ''))
    for await (const _hit of glob.scan({ cwd, onlyFiles: true, dot: false })) return true
  } catch {
    // An unreadable directory or a pattern Bun cannot read matches nothing.
  }
  return false
}

function patternMatches(pattern: string, cwd: string, now: number): Promise<boolean> {
  const key = `${cwd}\u0000${pattern}`
  const cached = memo.get(key)
  if (cached && now - cached.at < MEMO_TTL_MS) return cached.hit
  const hit = anyFileMatches(pattern, cwd)
  memo.set(key, { at: now, hit })
  return hit
}

/** The call names of the `paths:`-scoped skills that some file under `cwd` activates. */
export async function skillsMatchingProjectFiles(
  skills: readonly SkillListingEntry[],
  cwd: string,
  now: number = Date.now(),
): Promise<ReadonlySet<string>> {
  const out = new Set<string>()
  if (!cwd || cwd === '/') return out
  await Promise.all(
    skills.map(async (skill) => {
      if (!skill.activationPaths?.length || skill.disableModelInvocation) return
      for (const pattern of skill.activationPaths) {
        if (await patternMatches(pattern, cwd, now)) {
          out.add(skillCallName(skill))
          return
        }
      }
    }),
  )
  return out
}
