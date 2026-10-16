/**
 * Turn what an extension says about ITSELF into the trigger that surfaces it.
 *
 * A tip about a plugin has to know when the user is doing the thing that plugin is
 * for, and the only place that knowledge exists is the plugin's own manifest. The
 * alternative — a host-side table mapping "html|css|tailwind" to a plugin name —
 * is the defect this module replaces: it makes the host name individual plugins,
 * and it goes stale the moment a plugin is installed that the table never heard of.
 *
 * The output is a REGEXP SOURCE, not a compiled expression, because it travels to a
 * client over JSON and is applied there against the text the user typed. Matching is
 * case-insensitive at the call site, so every keyword is emitted lower-case.
 */

import { escapeRegExp } from '../../lib/regexp'

/**
 * Words that carry no topic. Deliberately short: this list exists to stop a pattern
 * from matching every message ("the", "with"), not to do linguistics. A word that
 * slips through costs one over-eager tip; an over-long list costs a plugin its only
 * trigger.
 *
 * The second group is MANIFEST BOILERPLATE — the verbs every plugin description opens
 * with ("Create and edit…", "Inspect and manage…"). They are not stopwords in English
 * and they are exactly what makes a trigger useless: "create" fires the spreadsheet
 * plugin's tip on "create a function", which is the one thing a contextual tip must
 * not do. What a plugin is ABOUT is in its nouns.
 */
const STOPWORDS = new Set([
  // Manifest boilerplate verbs.
  'create',
  'edit',
  'make',
  'manage',
  'support',
  'provide',
  'inspect',
  'content',
  // Ordinary function words.
  'about',
  'across',
  'after',
  'agent',
  'allow',
  'also',
  'from',
  'into',
  'inside',
  'over',
  'plugin',
  'plugins',
  'localix',
  'their',
  'them',
  'then',
  'this',
  'that',
  'these',
  'those',
  'through',
  'using',
  'with',
  'within',
  'when',
  'what',
  'your',
  'yours',
  'and',
  'for',
  'the',
])

/** Shorter than this and a word is noise ("api" is the tradeoff we accept losing). */
const MIN_KEYWORD_LENGTH = 4
/** A pattern past this many alternatives matches almost any message. */
const MAX_KEYWORDS = 8

/**
 * Drop a plural 's' so the pattern matches the form the USER typed.
 *
 * Manifests are written in the plural ("edit spreadsheets") and requests in the
 * singular ("fix the spreadsheet export"). Since every alternative is followed by
 * `\w*`, matching on the singular covers both, while matching on the plural covers
 * only the plural — which silently loses most of the matches the keyword was for.
 * `ss` endings (access, process) are not plurals and keep their tail.
 */
function singular(word: string): string {
  return word.length > MIN_KEYWORD_LENGTH && word.endsWith('s') && !word.endsWith('ss')
    ? word.slice(0, -1)
    : word
}

/**
 * A `\b(word|word)\w*` source built from the given prose, or `undefined` when the
 * prose yields nothing worth matching — an absent gate is better than one that
 * matches everything, because a tip with no gate still shows up in the generic pool.
 */
export function tipKeywordPattern(...parts: readonly string[]): string | undefined {
  const words = new Set<string>()
  for (const part of parts) {
    for (const word of part.toLowerCase().split(/[^a-z0-9+]+/)) {
      if (word.length < MIN_KEYWORD_LENGTH || STOPWORDS.has(word)) continue
      words.add(singular(word))
      if (words.size >= MAX_KEYWORDS) break
    }
    if (words.size >= MAX_KEYWORDS) break
  }
  if (words.size === 0) return undefined
  return `\\b(${[...words].map(escapeRegExp).join('|')})\\w*`
}
