/**
 * Which `paths:`-scoped skills the session's work activates.
 *
 * Claude Code reads a skill's `paths` as globs over FILES, relative to the working directory, and
 * offers the skill once Claude works with a matching file (skills.md, frontmatter `paths`; files
 * outside the working directory never match). `touched` are the files the session's file tools
 * read, wrote or edited (`touched-files.ts`), so a skill appears from the run after the first such
 * file and stays. The cwd-as-path match in `prompt-skills.ts` stays for skills written against
 * directories.
 */
import { isAbsolute, relative } from 'node:path'
import { skillCallName } from '../../agent-core/tools/skill-names'
import type { SkillListingEntry } from './prompt-skills'

function globMatchesAny(pattern: string, rels: readonly string[]): boolean {
  try {
    const glob = new Bun.Glob(pattern.replace(/\\/g, '/').replace(/^\.\//, ''))
    return rels.some((rel) => glob.match(rel))
  } catch {
    return false // a pattern Bun cannot read matches nothing
  }
}

/** The call names of the `paths:`-scoped skills a touched file under `cwd` activates. */
export function skillsMatchingFiles(
  skills: readonly SkillListingEntry[],
  cwd: string,
  touched: readonly string[],
): ReadonlySet<string> {
  const out = new Set<string>()
  const rels = touched
    .map((file) => relative(cwd, file).replace(/\\/g, '/'))
    .filter((rel) => rel && !rel.startsWith('..') && !isAbsolute(rel))
  if (rels.length === 0) return out
  for (const skill of skills) {
    if (!skill.activationPaths?.length) continue
    if (skill.activationPaths.some((pattern) => globMatchesAny(pattern, rels))) {
      out.add(skillCallName(skill))
    }
  }
  return out
}
