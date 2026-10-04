import { describe, expect, it } from 'bun:test'
import { decideFollowReveal, isCodeEditablePath, pickCodeEditablePaths } from './followAgentEdits'

describe('isCodeEditablePath', () => {
  it('accepts normal code/text files', () => {
    expect(isCodeEditablePath('/ws/src/app.ts')).toBe(true)
    expect(isCodeEditablePath('/ws/src/App.TSX')).toBe(true) // case-insensitive ext
    expect(isCodeEditablePath('/ws/README.md')).toBe(true)
    expect(isCodeEditablePath('/ws/config.yaml')).toBe(true)
    expect(isCodeEditablePath('/ws/query.sql')).toBe(true)
  })

  it('rejects viewer-doc types the document router owns', () => {
    expect(isCodeEditablePath('/ws/report.pdf')).toBe(false)
    expect(isCodeEditablePath('/ws/sheet.xlsx')).toBe(false)
    expect(isCodeEditablePath('/ws/doc.docx')).toBe(false)
    expect(isCodeEditablePath('/ws/data.csv')).toBe(false)
  })

  it('rejects directories / extensionless paths', () => {
    expect(isCodeEditablePath('/ws/src')).toBe(false)
    expect(isCodeEditablePath('/ws/src/components')).toBe(false)
    expect(isCodeEditablePath('/ws/Makefile')).toBe(false)
  })

  it('rejects dotfiles even with a known extension', () => {
    expect(isCodeEditablePath('/ws/.gitignore')).toBe(false)
    expect(isCodeEditablePath('/ws/.eslintrc.json')).toBe(false)
  })

  it('rejects obviously-binary files', () => {
    expect(isCodeEditablePath('/ws/logo.png')).toBe(false)
    expect(isCodeEditablePath('/ws/bundle.zip')).toBe(false)
    expect(isCodeEditablePath('/ws/app.wasm')).toBe(false)
  })
})

describe('pickCodeEditablePaths', () => {
  it('keeps code files, dedups, preserves order', () => {
    const paths = [
      '/ws/src', // dir
      '/ws/src/a.ts',
      '/ws/report.pdf', // viewer doc
      '/ws/src/b.tsx',
      '/ws/src/a.ts', // dup
      '/ws/logo.png', // binary
    ]
    expect(pickCodeEditablePaths(paths)).toEqual(['/ws/src/a.ts', '/ws/src/b.tsx'])
  })

  it('empty in → empty out', () => {
    expect(pickCodeEditablePaths([])).toEqual([])
    expect(pickCodeEditablePaths(['/ws/dir', '/ws/x.pdf'])).toEqual([])
  })
})

describe('decideFollowReveal', () => {
  const base = {
    isActiveSession: true,
    paths: ['/ws/src/a.ts', '/ws/src/b.ts'],
    seen: new Set<string>(),
    maxOpened: 12,
  }

  it('no-ops when the setting is off', () => {
    expect(decideFollowReveal({ ...base, enabled: false })).toBeNull()
  })

  it('no-ops for a background / non-active session', () => {
    expect(decideFollowReveal({ ...base, enabled: true, isActiveSession: false })).toBeNull()
  })

  it('no-ops on an empty / doc-only / dir-only event', () => {
    expect(decideFollowReveal({ ...base, enabled: true, paths: [] })).toBeNull()
    expect(
      decideFollowReveal({ ...base, enabled: true, paths: ['/ws/x.pdf', '/ws/dir'] }),
    ).toBeNull()
  })

  it('reveals the MOST-RECENT editable code file', () => {
    expect(decideFollowReveal({ ...base, enabled: true })).toBe('/ws/src/b.ts')
  })

  it('is idempotent: already-revealed target → null (replay/reconnect safe)', () => {
    const seen = new Set<string>(['/ws/src/b.ts'])
    expect(decideFollowReveal({ ...base, enabled: true, seen })).toBeNull()
  })

  it('respects the per-session cap', () => {
    const seen = new Set<string>(Array.from({ length: 12 }, (_, i) => `/ws/f${i}.ts`))
    expect(decideFollowReveal({ ...base, enabled: true, seen })).toBeNull()
  })
})
