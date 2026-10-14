import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The one rule about how a failure LOOKS, pinned.
 *
 * Errors used to be reported by whatever each feature invented: a bordered strip here, a tinted card
 * there, a panel with its own icon and its own red somewhere else. Nothing was wrong with any single
 * one of them; the product was wrong, because the same fact looked like a dozen different facts and
 * none of them were reachable once you looked away.
 *
 * So there is exactly one shape — `ProblemLine`, quiet and borderless, with the report itself in the
 * Event Center — and this test exists because that convergence is easy to lose one well-meaning
 * commit at a time. It is deliberately narrow: it does not police colour tokens, badges or diff
 * markers, only the thing that says "I am announcing a failure" wearing chrome that says "I am a
 * card". Same spirit as the Sonner boundary test next door.
 */

const ROOTS = [
  resolve(import.meta.dir, '../../..'),
  resolve(import.meta.dir, '../../../../../../plugins'),
  // The primitives that announce a failure (`Field`'s error line) moved here from `shared/ui`.
  resolve(import.meta.dir, '../../../../../../packages/kit/src'),
]
/** A card treatment: something that frames the announcement instead of stating it. */
const CHROME = /border-status-|bg-status-\w+\/|rounded-(md|lg|xl)|shadow-/
/** How far around the attribute a className can sit and still belong to the same element. */
const SPAN = 3

function framedAlerts(): string[] {
  const found: string[] = []
  for (const root of ROOTS) {
    for (const path of new Bun.Glob('**/*.tsx').scanSync({ cwd: root })) {
      if (path.includes('node_modules') || path.endsWith('.test.tsx')) continue
      const lines = readFileSync(resolve(root, path), 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!line.includes('role="alert"')) return
        const window = lines.slice(Math.max(0, index - SPAN), index + SPAN + 1).join(' ')
        if (CHROME.test(window)) found.push(`${path}:${index + 1}`)
      })
    }
  }
  return found
}

/**
 * A `<ProblemLine>` inside a hand-built centring wrapper. That wrapper is how the DevOps sidebar's
 * "centred" failure sat at the top of an empty pane: `flex-1 justify-center` in a block-level scroll
 * container centres nothing. A failure that is the whole pane is `ProblemState`, which owns the
 * geometry once; a line inside a populated surface needs no centring at all.
 */
// A PANE centre — filling the space (`flex-1`/`h-full`) and centring in it. A line merely centred
// across a list's tail (`flex justify-center py-3`) is a row, and stays a ProblemLine.
const HAND_CENTRED = /justify-center/
const FILLS_PANE = /\bflex-1\b|\bh-full\b/
const CENTRE_SPAN = 3

export function handCentredLines(source: string): number[] {
  const lines = source.split('\n')
  const found: number[] = []
  lines.forEach((line, index) => {
    if (!line.includes('<ProblemLine')) return
    const above = lines.slice(Math.max(0, index - CENTRE_SPAN), index + 1).join(' ')
    if (HAND_CENTRED.test(above) && FILLS_PANE.test(above)) found.push(index + 1)
  })
  return found
}

function handCentredProblems(): string[] {
  const found: string[] = []
  for (const root of ROOTS) {
    for (const path of new Bun.Glob('**/*.tsx').scanSync({ cwd: root })) {
      if (path.includes('node_modules') || path.endsWith('.test.tsx')) continue
      for (const line of handCentredLines(readFileSync(resolve(root, path), 'utf8'))) {
        found.push(`${path}:${line}`)
      }
    }
  }
  return found
}

describe('how a failure looks', () => {
  it('announces itself without a frame — no card, no border, no tint, no shadow', () => {
    expect(framedAlerts()).toEqual([])
  })

  it('a pane-level failure is ProblemState, never a line in a hand-built centre', () => {
    expect(handCentredProblems()).toEqual([])
  })

  it('the centring detector catches the shape that shipped (positive control)', () => {
    const shipped = [
      '  return (',
      '    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-8">',
      '      <ProblemLine {...problem} />',
      '    </div>',
    ].join('\n')
    expect(handCentredLines(shipped)).toEqual([3])
    expect(handCentredLines('<ProblemLine {...problem} className="px-3 py-1.5" />')).toEqual([])
    // A list-tail row centred across the width is not a pane.
    expect(
      handCentredLines('<div className="flex justify-center py-3">\n<ProblemLine {...p} />'),
    ).toEqual([])
  })
})
