import { discoverFilesystemSkills } from '../../../agent-core/skill-discovery'

/**
 * A SessionStart hook's `reloadSkills` (hooks.md, "Reload skills that a hook installs"): the run's
 * skills were found before its hooks ran, so the folders are read again. The cached discovery of
 * the scope is forgotten, so the next run lists them, and this run's agent is told of the skills
 * that appeared; the skill tool reads the folders when it is called, so it can load them now.
 */
export async function reloadedSkillsNote(input: {
  cwd: string
  /** The names this run's discovery already listed. */
  known: readonly string[]
  invalidate: () => void
}): Promise<string | undefined> {
  input.invalidate()
  const known = new Set(input.known)
  const added = (await discoverFilesystemSkills(input.cwd).catch(() => [])).filter(
    (skill) => !known.has(skill.name),
  )
  if (!added.length) return undefined
  return [
    'Skills a SessionStart hook installed, available with the skill tool:',
    ...added.map((skill) => `- ${skill.name}: ${skill.description}`),
  ].join('\n')
}
