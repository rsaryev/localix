import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import { escapeRegExp } from '../../../lib/regexp'

/**
 * Keyword-triggered skills: procedures the deployment refuses to leave to the model's
 * judgement.
 *
 * The listing tells the model which skills exist and asks it to retrieve the relevant one.
 * That is the right default — it costs a few hundred characters per skill instead of the
 * whole procedure — but it is a REQUEST, and a skill that must not be skipped ("before
 * deploying, always …") cannot depend on the model choosing to look it up. A keyword makes
 * the choice for it: the content is in the prompt before the model gets a say.
 *
 * Matched against the USER'S OWN MESSAGE only, and this is a boundary rather than a
 * convenience. Injected skill content is read as instruction, so a trigger that also read
 * tool results or file contents would let any repository holding the word "deploy" push
 * instructions into the prompt. The user's message is the one input the user authored.
 *
 * Word boundaries, not substrings: a `cat` keyword firing on "concatenate" would be a
 * surprise the author cannot see coming, while an author who wants prefix matching can list
 * the longer forms. Phrases work — the frontmatter list is comma-separated — and inside a
 * phrase, runs of whitespace are treated as equivalent, since a line break in the user's
 * message should not decide whether their procedure applies.
 */
export interface TriggeredSkill {
  name: string
  content: string
  /** The keyword that fired, for the section text — the model should know why it is here. */
  keyword: string
}

/** Word-boundary, whitespace-tolerant, case-insensitive test for one keyword. */
function mentions(text: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword.trim())
  if (!escaped) return false
  const pattern = escaped.replace(/\s+/gu, '\\s+')
  // \b would not fire for a keyword ending in punctuation, and a keyword is author-supplied
  // prose rather than an identifier — so the boundary is "not a word character on either
  // side", which behaves the same for ordinary words and does not silently never match.
  return new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, 'iu').test(text)
}

/**
 * The skills whose keywords appear in `text`, in discovery order, deduplicated by name.
 * `alreadyPinned` names are skipped: their content is in the prompt already, and a second
 * copy would spend the budget saying the same thing twice.
 */
export function resolveTriggeredSkills(
  skills: readonly DiscoveredSkill[],
  text: string | undefined,
  alreadyPinned: readonly string[] = [],
): TriggeredSkill[] {
  if (!text?.trim()) return []
  const pinned = new Set(alreadyPinned)
  const seen = new Set<string>()
  const out: TriggeredSkill[] = []
  for (const skill of skills) {
    if (!skill.keywords?.length || pinned.has(skill.name) || seen.has(skill.name)) continue
    const hit = skill.keywords.find((keyword) => mentions(text, keyword))
    if (!hit) continue
    seen.add(skill.name)
    out.push({
      name: skill.name,
      // Same shape as a pinned skill: relative references in a procedure resolve against
      // the skill's own directory, not the session cwd.
      content: [
        `Resolve relative references from: ${JSON.stringify(skill.dir)}`,
        '',
        skill.content,
      ].join('\n'),
      keyword: hit,
    })
  }
  return out
}
