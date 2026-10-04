/**
 * THE MUTATION MATRIX — the kit's proof that it can fail.
 *
 * A shared kit concentrates risk: one blind assumption now fails open across every lint at once,
 * instead of one. So the harness that certifies the lints has to be certified itself, and the only
 * certification worth anything is a mutation: break the detector on purpose and require the audit
 * to notice.
 *
 * Each mutant below is a real failure this repo actually shipped, or the obvious next one:
 *
 *   strip → ''         the exact mutation that left `wire-contract.test.ts` at 10 pass / 0 fail
 *                      while all four of its rules read an empty string.
 *   strip → identity   the original defect class: the lint reads comments as code, so the guarded
 *                      code can be commented out and every token stays where the lint looks.
 *   walk → flat        the wire walkers' bug: one directory level, so a wire at
 *                      `providers/<id>/wire/sse.mjs` was never opened — and no offenders found.
 *   pattern → never    a neutered rule.
 *   pattern → always   an over-broad rule that convicts compliant code (and gets deleted for noise).
 *   readRaw → ''       a reader that shrugs at a missing file instead of throwing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { codeOnly } from './code'
import { auditDetector, type OffenderShape } from './control'
import { type SourceDetector, sourceDetector } from './detector'
import { isSourceFile } from './tree'

/** Two real shapes from the wire contract, used as the harness's own subject. */
const SHAPES: OffenderShape[] = [
  {
    rule: 'RAW_ABORT',
    pattern: /new\s+DOMException\s*\([^)]*['"`]AbortError['"`]|\.name\s*=\s*['"`]AbortError['"`]/,
    bug: "export const f = (err) => { err.name = 'AbortError'; throw err }\n",
    clean:
      "// Never `new DOMException('Aborted', 'AbortError')` by hand — ask for the shape.\n" +
      "export const f = (e) => { if (e.name === 'AbortError') return; throw makeAbortError() }\n",
  },
  {
    rule: 'RAW_NORMALIZATION',
    pattern: /stopReason\s*=[^\n=][^\n]*['"`]tool_use['"`]/,
    bug: "export const f = (out, hasTool) => { out.stopReason = hasTool ? 'tool_use' : 'end_turn' }\n",
    clean:
      "// Never `out.stopReason = 'tool_use'` by hand — a max_tokens stop must survive to the loop.\n" +
      'export const f = (out, r, hasTool) => { out.stopReason = finalStopReason(r, hasTool) }\n',
  },
]

/** A walker that reads exactly ONE directory level — the wire walkers' actual bug. */
const flatWalk = (dir: string): string[] => {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .map((e) => join(dir, e))
    .filter((full) => {
      try {
        return statSync(full).isFile() && isSourceFile(full)
      } catch {
        return false
      }
    })
}

const mutate = (patch: Partial<SourceDetector>): SourceDetector => ({ ...sourceDetector, ...patch })

describe('the real detector passes its own audit', () => {
  test('no findings — the pipeline reads code, recurses, and ignores prose', () => {
    expect(auditDetector(SHAPES)).toEqual([])
  })
})

describe('MUTATION MATRIX: every way of blinding the detector must go RED', () => {
  test("strip → '' (reads nothing) is caught", () => {
    const findings = auditDetector(SHAPES, mutate({ strip: () => '' }))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.join('\n')).toContain('did not report the planted offender')
  })

  test('strip → identity (reads comments as code) is caught', () => {
    const findings = auditDetector(SHAPES, mutate({ strip: (s) => s }))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.join('\n')).toContain('reported COMPLIANT code as an offender')
  })

  test('walk → non-recursive (never opens the nested wire) is caught', () => {
    const findings = auditDetector(SHAPES, mutate({ walk: flatWalk }))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.join('\n')).toContain('the walker did not find what it was pointed at')
    expect(findings.join('\n')).toContain('does not recurse')
  })

  test('walk → [] (an empty tree, indistinguishable from a clean one) is caught', () => {
    const findings = auditDetector(SHAPES, mutate({ walk: () => [] }))
    expect(findings.length).toBeGreaterThan(0)
  })

  test('walk → includes test files (the lint convicts its own fixtures) is caught', () => {
    const greedy = (dir: string): string[] => {
      const out: string[] = []
      for (const e of readdirSync(dir)) {
        const full = join(dir, e)
        if (statSync(full).isDirectory()) out.push(...greedy(full))
        else out.push(full)
      }
      return out
    }
    expect(auditDetector(SHAPES, mutate({ walk: greedy })).length).toBeGreaterThan(0)
  })

  test("readRaw → '' (a reader that shrugs at a missing file) is caught", () => {
    const findings = auditDetector(SHAPES, mutate({ readRaw: () => '' }))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.join('\n')).toContain('did not report the planted offender')
  })

  test('a NEUTERED rule is caught', () => {
    const dead = SHAPES.map((s) => ({ ...s, pattern: /$^/ }))
    expect(auditDetector(dead).length).toBe(SHAPES.length)
  })

  test('an OVER-BROAD rule (convicts compliant code) is caught', () => {
    const broad = SHAPES.map((s) => ({ ...s, pattern: /export/ }))
    const findings = auditDetector(broad)
    expect(findings.join('\n')).toContain('reported COMPLIANT code as an offender')
  })

  test('a control with no shapes is itself a finding — it controls nothing', () => {
    expect(auditDetector([]).length).toBe(1)
  })
})

describe('the audit is not satisfiable by accident', () => {
  test('the real stripper is what the real detector uses', () => {
    // Guards the seam: if `sourceDetector.strip` were ever rewired to something else, every mutant
    // above would mutate a function nobody calls, and the whole matrix would pass while proving
    // nothing. Read the wiring, do not assume it.
    const src = codeOnly(readFileSync(new URL('./detector.ts', import.meta.url), 'utf8'))
    expect(src).toMatch(/strip:\s*codeOnly/)
    expect(src).toMatch(/walk:\s*walkSources/)
  })
})
