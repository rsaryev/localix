import { parseSlashInvocation } from './slash-commands'
import type { SkillRecord } from './skills'

/** Claude Code expands "the first skill plus up to five more stacked after it". */
const MAX_STACKED = 5

/**
 * The skills stacked after the first in `/write-tests /fix-issue 123`, and the arguments every one
 * of them takes (skills.md, "Stack several skills in one message"). Expansion stops at the first
 * token that is not an inline, user-invocable skill — a forked skill, a built-in command, plain
 * text — and that token and the rest are the arguments.
 */
export async function stackedSkills(
  arg: string,
  resolve: (name: string) => Promise<SkillRecord | undefined>,
): Promise<{ extra: SkillRecord[]; arg: string }> {
  const extra: SkillRecord[] = []
  let rest = arg
  while (extra.length < MAX_STACKED) {
    const next = parseSlashInvocation(rest)
    if (!next) break
    const skill = await resolve(next.name)
    if (!skill || skill.contextFork || skill.userInvocable === false) break
    if (!extra.some((s) => s.name === skill.name)) extra.push(skill)
    rest = next.arg
  }
  return { extra, arg: rest }
}
