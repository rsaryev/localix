/**
 * cURL command → collected flags. The MECHANICAL half of the curl importer: it decides what is a
 * flag, what is a flag's value, and what is a bare argument. It does not know what any flag MEANS
 * — that is `curl.ts`.
 *
 * Splitting the two is what makes the awkward cases testable in isolation: squished short flags
 * (`-XPOST`), repeated flags (`-H a -H b`), and ignored-but-valued flags whose value must be
 * eaten (`-o out.json`) are all decided here, with no url or auth in sight.
 */

import { parse, type ParseEntry } from 'shell-quote'
import { BOOLEAN_FLAGS, IGNORED_VALUE_FLAGS, SUPPORTED_FLAGS } from './curl-flags'

/** Every occurrence of each read flag, in order. `true` is a boolean flag's presence. */
export type FlagValues = Record<string, (string | boolean)[]>

export interface CurlCommand {
  flags: FlagValues
  /** Bare arguments — the url is normally the first of these. */
  bare: string[]
}

/** True when a token looks like a flag (`-X`, `--data-raw`) rather than a value. */
function isFlag(token: string): boolean {
  return /^-{1,2}[A-Za-z]/.test(token)
}

/**
 * shell-quote yields objects for shell operators (`|`, `&&`, globs). A curl command containing
 * them is being piped into something; we import the curl part and let the rest go, so any
 * non-string entry ENDS the command rather than being coerced into a value.
 */
function stringsBeforeOperator(entries: ParseEntry[]): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push(entry)
      continue
    }
    // shell-quote represents an unquoted `?`, `*`, or `[…]` URL as a glob token. It is still the
    // URL curl receives when the shell finds no filesystem match, not a pipeline boundary. Actual
    // operators (`|`, `&&`, `;`, …) have no pattern and still end the command.
    if (
      entry &&
      typeof entry === 'object' &&
      'op' in entry &&
      entry.op === 'glob' &&
      'pattern' in entry &&
      typeof entry.pattern === 'string'
    ) {
      out.push(entry.pattern)
      continue
    }
    break
  }
  return out
}

/**
 * Strip a leading `curl`, plus the line continuations and `$` prompt that survive a copy-paste
 * from documentation. shell-quote handles the quoting; this handles the framing.
 */
function normalize(command: string): string {
  return command
    .trim()
    .replace(/^\$\s+/, '') // a copied shell prompt
    .replace(/\\\r?\n/g, ' ') // line continuations
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*\$?\s*curl\s/.test(text)
}

export function parseCurl(command: string): CurlCommand {
  const tokens = stringsBeforeOperator(parse(normalize(command)) as ParseEntry[])
  const flags: FlagValues = {}
  const bare: string[] = []

  const push = (name: string, value: string | boolean) => {
    ;(flags[name] ??= []).push(value)
  }

  // Start at 1: skip the `curl` itself.
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i].trim()
    if (token === '') continue

    if (!isFlag(token)) {
      bare.push(token)
      continue
    }

    const isShort = token[0] === '-' && token[1] !== '-'
    let name = token.replace(/^-{1,2}/, '')
    let squished: string | undefined

    // A squished short flag: `-XPOST` is `-X POST`, and `-H` is not. Only short flags squish, so
    // `--data-raw` never splits into `-d` + `ata-raw`.
    if (isShort && name.length > 1 && !BOOLEAN_FLAGS.includes(name)) {
      squished = name.slice(1)
      name = name.slice(0, 1)
    }

    if (!SUPPORTED_FLAGS.includes(name)) {
      // Consume the value of an ignored flag, or it is left behind and read as the url.
      const next = tokens[i + 1]
      const nextIsValue = typeof next === 'string' && !isFlag(next)
      if (squished === undefined && nextIsValue && IGNORED_VALUE_FLAGS.includes(name)) i++
      continue
    }

    if (BOOLEAN_FLAGS.includes(name)) {
      push(name, true)
      continue
    }
    if (squished !== undefined) {
      push(name, squished)
      continue
    }

    const next = tokens[i + 1]
    if (typeof next === 'string' && !isFlag(next)) {
      push(name, next)
      i++
    } else {
      push(name, true)
    }
  }

  return { flags, bare }
}

/** The first value of any of `names`, or `fallback`. Later aliases do not shadow earlier ones. */
export function flagValue(flags: FlagValues, names: readonly string[]): string | undefined {
  for (const name of names) {
    const found = flags[name]?.find((v) => typeof v === 'string')
    if (typeof found === 'string') return found
  }
  return undefined
}

/** True when any of `names` is present at all (boolean flags). */
export function flagPresent(flags: FlagValues, names: readonly string[]): boolean {
  return names.some((name) => (flags[name]?.length ?? 0) > 0)
}

/** Every string value across all of `names`, in order. */
export function flagValues(flags: FlagValues, names: readonly string[]): string[] {
  const out: string[] = []
  for (const name of names) {
    for (const v of flags[name] ?? []) if (typeof v === 'string') out.push(v)
  }
  return out
}
