import { readFile } from 'node:fs/promises'
import type { PluginSession, SessionSkill } from '@rsaryev/llx-plugin'
import { parseFrontmatter } from '@rsaryev/llx-plugin/format'
import { skillLookup } from '@rsaryev/llx-plugin/skills'

/**
 * A skill's text as a prompt holds it: its body as the file holds it now (no substitution, no `!`
 * command run, no tool granted), after the folder its relative references resolve from.
 */
export interface SkillText {
  /** The name it is listed by: `deploy`, `my-plugin:review`. */
  readonly name: string
  readonly content: string
}

const textOf = (name: string, dir: string | undefined, body: string): SkillText => ({
  name,
  content: dir ? `Resolve relative references from: ${JSON.stringify(dir)}\n\n${body}` : body,
})

async function bodyOf(row: SessionSkill): Promise<string | undefined> {
  if (!row.file) return undefined
  const text = await readFile(row.file, 'utf8').catch(() => undefined)
  return text === undefined ? undefined : parseFrontmatter(text).body
}

/**
 * The skills the person chose by name (a session's pins, a keyword of their message), found by every
 * name the kit answers to, in the order named and each once. A pin is the person's own choice, so
 * `disable-model-invocation` does not hide one; a skill whose file is gone is left out.
 */
export async function skillTexts(
  session: PluginSession,
  names: readonly string[],
  signal: AbortSignal,
): Promise<SkillText[]> {
  const lookup = skillLookup(session.skillCatalog().skills)
  const seen = new Set<string>()
  const out: SkillText[] = []
  for (const name of names) {
    if (signal.aborted) break
    const row = lookup.find(name)
    if (!row || seen.has(row.invocable.command)) continue
    seen.add(row.invocable.command)
    const body = await bodyOf(row)
    if (body !== undefined) out.push(textOf(row.invocable.command, row.directory, body))
  }
  return out
}

/**
 * The skills an agent file's `skills` preloads, as the kit plans them (sub-agents.md, "Preload
 * skills into subagents"): one Claude may not invoke, or whose body cannot be read, is skipped.
 */
export async function preloadedSkillTexts(
  session: PluginSession,
  names: readonly string[],
  signal: AbortSignal,
): Promise<SkillText[]> {
  const { preloaded } = await session.preloadSkills({ skills: [...names] }, { signal })
  // The row's folder is absolute for every source; a plugin skill's own `dir` is the plugin's.
  const folders = new Map(
    session.skillCatalog().skills.map((row) => [row.invocable.command, row.directory]),
  )
  return preloaded.map((skill) => textOf(skill.command, folders.get(skill.command), skill.body))
}
