import { describe, test, expect } from 'bun:test'
import type { LspDiagnostic } from './lsp-client'
import { buildInlineDiagnostics } from './diagnostics-report'

const ROOT = '/proj'

function err(line: number, message: string, code?: string | number): LspDiagnostic {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 1 } },
    severity: 1,
    message,
    ...(code !== undefined ? { code } : {}),
  }
}

function warn(line: number, message: string): LspDiagnostic {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 1 } },
    severity: 2,
    message,
  }
}

describe('buildInlineDiagnostics', () => {
  test('returns an empty block when the edited file is clean', () => {
    const report = buildInlineDiagnostics(['/proj/src/a.ts'], {}, ROOT)
    expect(report.block).toBe('')
    expect(report.fileErrorCount).toBe(0)
    expect(report.otherErrorCount).toBe(0)
  })

  test('ignores warnings/info/hints — only errors are surfaced', () => {
    const report = buildInlineDiagnostics(
      ['/proj/src/a.ts'],
      { '/proj/src/a.ts': [warn(1, 'unused var')] },
      ROOT,
    )
    expect(report.block).toBe('')
    expect(report.fileErrorCount).toBe(0)
  })

  test('renders errors for the edited file with a relative path and line:col', () => {
    const report = buildInlineDiagnostics(
      ['/proj/src/a.ts'],
      { '/proj/src/a.ts': [err(4, "Cannot find name 'foo'", 2304)] },
      ROOT,
    )
    expect(report.fileErrorCount).toBe(1)
    expect(report.block).toContain('<diagnostics file="src/a.ts">')
    expect(report.block).toContain("[5:1] Cannot find name 'foo' (2304)")
    expect(report.block).toContain('fix them before continuing')
  })

  test('caps per-file errors at 15 and reports the overflow count', () => {
    const many = Array.from({ length: 20 }, (_, i) => err(i, `err ${i}`))
    const report = buildInlineDiagnostics(['/proj/src/a.ts'], { '/proj/src/a.ts': many }, ROOT)
    expect(report.fileErrorCount).toBe(20)
    expect(report.block).toContain('… and 5 more errors')
    // Only 15 numbered error lines should render.
    const shown = report.block.split('\n').filter((l) => /^\s+\[\d+:\d+\]/.test(l))
    expect(shown.length).toBe(15)
  })

  test('separates edited-file errors from other-file errors', () => {
    const report = buildInlineDiagnostics(
      ['/proj/src/a.ts'],
      {
        '/proj/src/a.ts': [err(0, 'broken here')],
        '/proj/src/b.ts': [err(0, 'broken elsewhere')],
      },
      ROOT,
    )
    expect(report.fileErrorCount).toBe(1)
    expect(report.otherErrorCount).toBe(1)
    expect(report.block).toContain('the file you just changed')
    expect(report.block).toContain('errors in other files')
    expect(report.block).toContain('src/b.ts')
  })

  test('caps the number of OTHER files shown and reports hidden file count', () => {
    const diags: Record<string, LspDiagnostic[]> = { '/proj/src/edited.ts': [err(0, 'x')] }
    for (let i = 0; i < 8; i++) diags[`/proj/src/other${i}.ts`] = [err(0, `e${i}`)]
    const report = buildInlineDiagnostics(['/proj/src/edited.ts'], diags, ROOT)
    expect(report.otherErrorCount).toBe(8)
    // 5 other-file blocks shown, 3 hidden.
    const fileBlocks = report.block.match(/<diagnostics file="src\/other\d\.ts">/g) ?? []
    expect(fileBlocks.length).toBe(5)
    expect(report.block).toContain('3 more files with errors')
  })

  test('collapses multiline diagnostic messages onto one line', () => {
    const report = buildInlineDiagnostics(
      ['/proj/src/a.ts'],
      { '/proj/src/a.ts': [err(0, 'line one\n  line two')] },
      ROOT,
    )
    expect(report.block).toContain('[1:1] line one line two')
    expect(report.block).not.toContain('line one\n  line two')
  })

  test('keeps absolute path for files outside the project root', () => {
    const report = buildInlineDiagnostics(
      ['/elsewhere/x.ts'],
      { '/elsewhere/x.ts': [err(0, 'oops')] },
      ROOT,
    )
    expect(report.block).toContain('<diagnostics file="/elsewhere/x.ts">')
  })
})

describe('identical-error grouping', () => {
  test('same message+code at many positions collapses to one line', () => {
    const dupes = [12, 40, 77, 90, 105].map((l) => err(l, "Property 'x' does not exist", 2339))
    const report = buildInlineDiagnostics(['/proj/src/a.ts'], { '/proj/src/a.ts': dupes }, ROOT)
    expect(report.block).toContain(
      "[13:1, 41:1, 78:1 (+2 more)] Property 'x' does not exist (2339)",
    )
    // One grouped line, not five.
    expect(report.block.split("Property 'x' does not exist").length - 1).toBe(1)
    expect(report.fileErrorCount).toBe(5)
  })

  test('distinct errors keep their own lines and single-position format', () => {
    const report = buildInlineDiagnostics(
      ['/proj/src/a.ts'],
      { '/proj/src/a.ts': [err(3, 'first problem', 'E1'), err(9, 'second problem', 'E2')] },
      ROOT,
    )
    expect(report.block).toContain('[4:1] first problem (E1)')
    expect(report.block).toContain('[10:1] second problem (E2)')
  })
})
