import { editFrontmatter } from '@rsaryev/llx-plugin/format'

/**
 * A Markdown file Localix writes (a skill's `SKILL.md`, an agent file) with `changes` set in its
 * frontmatter and `body` after it, as the kit's `editFrontmatter` writes it: a key the file has
 * keeps its place, a new one goes after the others, `undefined` removes one, comments and other
 * keys stay, the body is written as given. A block that does not read is refused rather than
 * overwritten: a save never drops what it cannot read.
 */
export function frontmatterFileText(
  text: string,
  changes: Readonly<Record<string, unknown>>,
  body: string,
): string {
  const edit = editFrontmatter(text, changes, body)
  if (!edit.ok) throw new Error(`The existing frontmatter cannot be read: ${edit.problem}`)
  return edit.text
}
