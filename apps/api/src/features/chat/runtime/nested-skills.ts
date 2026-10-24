import { dirname, join, relative, sep } from 'node:path'
import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import { scanScope } from '../../agent-core/skill-scan'

/**
 * Skills in a folder BELOW the working directory, loaded once the session works with a file there
 * (skills.md, "Load skills in monorepos and subdirectories"). A name another skill already has is
 * qualified by the folder (`apps/web:deploy`), and its description names the folder it applies to.
 */
export async function nestedSkillsForTouched(
  cwd: string,
  touched: readonly string[],
  taken: ReadonlySet<string>,
): Promise<DiscoveredSkill[]> {
  const dirs = new Set<string>()
  for (const file of touched) {
    const rel = relative(cwd, dirname(file))
    if (!rel || rel.startsWith('..')) continue
    const parts = rel.split(sep)
    for (let i = 1; i <= parts.length; i++) {
      if (parts[i - 1]!.startsWith('.') || parts[i - 1] === 'node_modules') break
      dirs.add(join(cwd, ...parts.slice(0, i)))
    }
  }
  const out: DiscoveredSkill[] = []
  const names = new Set(taken)
  for (const dir of [...dirs].sort()) {
    const where = relative(cwd, dir).split(sep).join('/')
    for (const skill of await scanScope(dir, 'project')) {
      if (names.has(skill.name)) {
        skill.name = `${where}:${skill.name}`
        skill.description = `${skill.description} (for files in ${where})`
      }
      if (names.has(skill.name)) continue
      names.add(skill.name)
      out.push(skill)
    }
  }
  return out
}
