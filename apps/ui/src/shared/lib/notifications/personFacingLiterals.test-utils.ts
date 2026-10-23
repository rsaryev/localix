import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The string literals a PERSON reads, found in source, for the wording and vocabulary guards.
 *
 * Both guards used to read only `toast(...)` titles, so a sentence that failed every rule simply had
 * to live one call over — in a `setError(...)`, a `failureSentence(e, '…')` fallback or a problem
 * report's `message` — to pass. "Failed to load skills" sat under a settings form while the journal
 * next to it had been cleaned of the same phrase. One extractor feeds both guards, so a new place a
 * sentence can live is added once and policed by every rule.
 *
 * Each literal carries its CLASS, because the classes are punctuated differently:
 * - `headline` — a journal row's title (`toast.*`, `runPluginAction`'s failure);
 * - `inline` — the error line under a control and a `ProblemLine` message;
 * - `body` — a toast's `description`, checked for vocabulary only.
 */

export type LiteralClass = 'headline' | 'inline' | 'body'

export interface PersonFacingLiteral {
  text: string
  line: number
  literalClass: LiteralClass
}

const Q = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\])*)\1`
const re = (source: string) => new RegExp(source, 'g')
/** `setError(`, `setFormError(`, `setReconnectError(id, ` — the inline error setters. */
const SET_ERROR = String.raw`\bset(?:[A-Z]\w*)?Error\((?:\s*\w+\s*,)?`

/** Detector → class. The literal is always capture group 2. */
const DETECTORS: readonly { pattern: RegExp; literalClass: LiteralClass; uiOnly?: boolean }[] = [
  {
    pattern: re(String.raw`\btoast(?:\.(?:error|warning|success|info|message))?\(\s*${Q}`),
    literalClass: 'headline',
  },
  {
    pattern: re(String.raw`\brunPluginAction\([\s\S]{0,600}?,\s*${Q}\s*,?\s*\)`),
    literalClass: 'headline',
  },
  // A toast's own description only: `description:` elsewhere is a surface or tool description the
  // AGENT reads, whose vocabulary is the model's.
  {
    pattern: re(String.raw`\btoast(?:\.\w+)?\([^;]{0,300}?\bdescription:\s*${Q}`),
    literalClass: 'body',
    uiOnly: true,
  },
  { pattern: re(String.raw`${SET_ERROR}\s*${Q}\s*\)`), literalClass: 'inline', uiOnly: true },
  {
    pattern: re(String.raw`${SET_ERROR}\s*\{[^}]{0,200}?\bmessage:\s*${Q}`),
    literalClass: 'inline',
    uiOnly: true,
  },
  // A fallback sentence, or the `instanceof … ? e.message : '…'` one, only where it IS the line:
  // the same helpers also build fragments ("could not be read") and agent-facing payloads.
  {
    pattern: re(
      String.raw`(?:${SET_ERROR}|\bmessage:)\s*(?:failureSentence|inlineFailure|errorMessage|vaultFailure|documentFailure|dbProblem)\([^,()]{1,80},\s*${Q}\s*\)`,
    ),
    literalClass: 'inline',
    uiOnly: true,
  },
  {
    pattern: re(
      String.raw`(?:${SET_ERROR}|\bmessage:)\s*\w+\s+instanceof\s+\w+\s*\?\s*[\w.]+\.message\s*:\s*${Q}`,
    ),
    literalClass: 'inline',
    uiOnly: true,
  },
  {
    pattern: re(String.raw`\bproblems:\s*\[\s*\{[^\]]{0,300}?\bmessage:\s*${Q}`),
    literalClass: 'inline',
    uiOnly: true,
  },
]

export const isCommentLine = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line)

export function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/** Every person-facing literal in one source, in order of appearance. */
export function personFacingLiterals(source: string, ui = true): PersonFacingLiteral[] {
  const found: PersonFacingLiteral[] = []
  const lines = source.split('\n')
  for (const { pattern, literalClass, uiOnly } of DETECTORS) {
    if (uiOnly && !ui) continue
    for (const match of source.matchAll(pattern)) {
      const text = match[2]!
      if (!text.trim()) continue
      // The literal's own offset, so the reported line is the sentence's, not the call's.
      const at = match.index! + match[0].lastIndexOf(text)
      const line = lineOf(source, at)
      // A comment quoting a call is history, not copy.
      if (isCommentLine(lines[line - 1] ?? '')) continue
      found.push({ text, line, literalClass })
    }
  }
  return found.sort((a, b) => a.line - b.line)
}

const ROOTS = [
  resolve(import.meta.dir, '../../..'),
  resolve(import.meta.dir, '../../../../../../plugins'),
  resolve(import.meta.dir, '../../../../../../packages/mini-app-sdk/src'),
]

/** A plugin's backend and shared code speak to its UI and the agent, not to a person directly. */
const isUiPath = (root: number, path: string) =>
  root === 0 || (root === 1 ? /(^|\/)ui\//.test(path) : path.startsWith('ui/'))

/** Runs `check` over every non-test source the person-facing guards cover. */
export function scanSources(check: (source: string, path: string, ui: boolean) => string[]) {
  const found: string[] = []
  ROOTS.forEach((root, index) => {
    for (const path of new Bun.Glob('**/*.{ts,tsx,mjs}').scanSync({ cwd: root })) {
      if (/node_modules|\/dist\/|\.test\.|\.test-utils\.|\/testing\//.test(path)) continue
      found.push(...check(readFileSync(resolve(root, path), 'utf8'), path, isUiPath(index, path)))
    }
  })
  return found
}
