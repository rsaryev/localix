/**
 * CSS-class hygiene for element identification: strip CSS-module / styled-component
 * hash suffixes, reject junk, and tell a generic Tailwind/atomic utility (not
 * identifying) apart from a semantic component/BEM/icon class (identifying). Split
 * out of core/identify.ts (which re-exports the public ones); vanilla DOM, zero deps.
 */

/**
 * Strip CSS-module / styled-component hash suffixes and reject junk classes, while
 * KEEPING meaningful hyphenated names (`lucide-filter`, `rounded-md`, `my-thing`).
 * Only a hash-LIKE suffix (one containing a digit, e.g. `_a1b2c` / `-x7f2a3`) is
 * dropped — a plain `-filter` is content, not a hash.
 */
export function cleanClass(c: string): string | null {
  if (!c) return null
  const stripped = c
    .replace(/_[A-Za-z0-9]{5,}$/, '')
    .replace(/-[A-Za-z0-9]{5,}$/, (s) => (/\d/.test(s) ? '' : s))
  if (stripped.length <= 2) return null
  if (/^[a-z]{1,2}$/.test(stripped)) return null // single utility letters
  if (/^[A-Za-z0-9]{8,}$/.test(stripped) && !/[aeiou]/i.test(stripped)) return null // looks like a hash
  return stripped
}

export function meaningfulClasses(el: Element): string[] {
  const raw = typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? '')
  return raw
    .split(/\s+/)
    .map(cleanClass)
    .filter((c): c is string => !!c)
}

// Conservative Tailwind/atomic-utility detector: these classes are NOT identifying
// (they appear all over the page), so we never use them as the sole selector. A
// non-utility framework keeps its semantic class names untouched.
const UTILITY_PREFIX =
  /^-?(?:m|p)[trblxy]?-|^-?(?:w|h|min-|max-|top|left|right|bottom|inset|gap|space-[xy]|text|bg|border|rounded|shadow|font|leading|tracking|opacity|z|order|col|row|items|justify|self|content|place|object|overflow|cursor|select|pointer|transition|duration|delay|ease|animate|scale|rotate|translate|skew|origin|fill|stroke|ring|outline|divide|backdrop|blur|brightness|contrast|grayscale|aspect|columns|basis|grow|shrink|float|clear|align|whitespace|break|line-clamp)-/
const UTILITY_ATOM = new Set([
  'flex',
  'grid',
  'block',
  'inline',
  'inline-flex',
  'inline-block',
  'hidden',
  'contents',
  'table',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'static',
  'isolate',
  'truncate',
  'italic',
  'underline',
  'uppercase',
  'lowercase',
  'capitalize',
  'antialiased',
  'tabular-nums',
  'sr-only',
  'container',
  'group',
  'peer',
])

export function isUtilityClass(c: string): boolean {
  const base = c.replace(/^[a-z0-9-]+:/, '') // strip a variant prefix (hover:, md:, dark:)
  return UTILITY_ATOM.has(base) || UTILITY_PREFIX.test(base)
}

/** Meaningful classes that are NOT generic utilities — these actually identify the element
 *  (component/BEM names, and specific icon classes like `lucide-filter`). */
export function identifyingClasses(el: Element): string[] {
  return meaningfulClasses(el).filter((c) => !isUtilityClass(c))
}

export function getCleanedClasses(el: Element): string {
  return meaningfulClasses(el).join(' ')
}
