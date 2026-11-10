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

/** A skill a keyword of the message fired, by the name it is listed by. */
export interface KeywordHit {
  name: string
  keyword: string
}

/**
 * The skills whose keywords appear in `text`, in listing order, each once on its first matching
 * keyword. The run leaves out the pinned ones (their text is in the prompt already) and reads the
 * texts of the rest (`run-skills.ts`).
 */
export function triggeringKeywords(
  skills: readonly { readonly name: string; readonly keywords?: readonly string[] }[],
  text: string | undefined,
): KeywordHit[] {
  if (!text?.trim()) return []
  const seen = new Set<string>()
  const out: KeywordHit[] = []
  for (const skill of skills) {
    if (!skill.keywords?.length || seen.has(skill.name)) continue
    const keyword = skill.keywords.find((one) => mentions(text, one))
    if (!keyword) continue
    seen.add(skill.name)
    out.push({ name: skill.name, keyword })
  }
  return out
}
