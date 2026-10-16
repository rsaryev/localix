/**
 * Reading a markdown file's frontmatter, and reading VALUES out of it.
 *
 * Nothing here knows what a skill is. It was living in `skill-frontmatter.ts` only because
 * skills were the first caller, and that file had grown into three subjects: how frontmatter
 * parses, how one of its values splits into a list, and what a SKILL.md means. The first two
 * are the same subject and belong to any markdown artifact with a header.
 */
// Reading the frontmatter is the one YAML parse in `frontmatter-yaml.ts`; a hand-rolled line
// reader used to live here and could read a file differently from the YAML parse of the same
// block. The VALUE splitting below is this module's own.
export { parseMarkdownFrontmatter } from './frontmatter-yaml'

/**
 * Split a space/comma/YAML-inline-array string (or a pre-parsed string array from
 * block-list YAML frontmatter) into trimmed non-empty tokens. Respects parentheses
 * so `Bash(git *)` stays as one token, not `['Bash(git', '*)']`.
 *
 * When given a `string[]` (already parsed by `parseMarkdownFrontmatter` block-list
 * logic), strips any remaining quotes from each item and returns the result directly
 * — no further splitting needed.
 */
export function splitTokenList(raw: string | string[] | undefined): string[] | undefined {
  if (!raw) return undefined
  // Block-list path: already an array from parseMarkdownFrontmatter.
  if (Array.isArray(raw)) {
    const out = raw.map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    return out.length ? out : undefined
  }
  const normalized = raw
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^["']|["']$/g, '')
  const out: string[] = []
  let buf = ''
  let depth = 0
  for (const ch of normalized + ',') {
    if (ch === '(') {
      depth++
      buf += ch
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1)
      buf += ch
    } else if ((ch === ',' || ch === ' ') && depth === 0) {
      const t = buf.trim().replace(/^["']|["']$/g, '')
      if (t) out.push(t)
      buf = ''
    } else {
      buf += ch
    }
  }
  return out.length ? out : undefined
}

/**
 * A comma-separated list whose entries may contain spaces.
 *
 * Deliberately NOT {@link splitTokenList}, which also splits on whitespace: that is right for
 * tool names and globs, and wrong for prose. `keywords: deploy to prod` under that rule
 * becomes three keywords, one of which is "to" — a trigger that fires on nearly every
 * message. A block list (`keywords:` followed by `- item` lines) arrives pre-split and is
 * passed through unchanged.
 */
export function splitPhraseList(raw: string | string[] | undefined): string[] | undefined {
  if (!raw) return undefined
  const parts = Array.isArray(raw)
    ? raw
    : raw
        .trim()
        .replace(/^\[|\]$/gu, '')
        .split(',')
  const out = parts
    .map((part) =>
      part
        .trim()
        .replace(/^["']|["']$/gu, '')
        .trim(),
    )
    .filter(Boolean)
  return out.length ? out : undefined
}
