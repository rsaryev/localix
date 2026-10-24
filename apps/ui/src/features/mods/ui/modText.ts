import type { ModElement } from '@/shared/api/modsApi'
import { toneOf } from './modColor'

/**
 * What a line of a mod's text IS, read from its shape alone — the two things a terminal can only
 * say with characters and colour, and Localix draws with its own components:
 *
 * - A diff line: a Text of one string, green after `+ ` or red after `- ` (a sign, then a space
 *   or nothing). Drawn as the app's diff view draws an added or removed row. `+31` is a count,
 *   not a line; a sign in the other colour is not a diff's.
 * - A leading glyph: a symbol and the space after it (`▶ `, `☁ `, `⚠ `) is an icon, drawn at the
 *   text's size in the faint tone, so the words after it carry the line.
 */

type Node = ModElement | string

const onlyString = (children: readonly Node[]): string | null =>
  children.length === 1 && typeof children[0] === 'string' ? children[0] : null

export interface DiffLine {
  kind: 'add' | 'del'
  sign: '+' | '-'
  rest: string
}

export function diffLineOf(
  props: Record<string, unknown>,
  children: readonly Node[],
): DiffLine | null {
  const line = onlyString(children)
  const match = line === null ? null : /^([+-])(\s.*|)$/s.exec(line)
  if (!match) return null
  const tone = toneOf(props.color)
  const sign = match[1] as '+' | '-'
  if (sign === '+' && tone === 'success') return { kind: 'add', sign, rest: match[2]! }
  if (sign === '-' && tone === 'danger') return { kind: 'del', sign, rest: match[2]! }
  return null
}

/** Pictographs, dingbats, arrows and geometric shapes — not letters, digits or ASCII signs. */
const GLYPH = /^([\p{So}←-⇿⌀-⏿■-◿☀-➿])(?=\s)/u

export function leadingGlyphOf(children: readonly Node[]): { glyph: string; rest: string } | null {
  const first = children[0]
  if (typeof first !== 'string' || children.length !== 1) return null
  const match = GLYPH.exec(first)
  return match ? { glyph: match[1]!, rest: first.slice(match[1]!.length) } : null
}
