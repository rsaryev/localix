import { describe, expect, test } from 'bun:test'
import { parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

import fileSurface from '@/features/inspector/ui/FileTab.surface'
import chatSurface from './ChatSurface.surface'

/**
 * The seam between what a source PRODUCER writes and what a UI surface can OPEN.
 *
 * `SourceRow` renders three ways: an `<a>` for http(s), a `<button>` for a `localix://` URI that
 * resolves, and an inert `<div>` for anything else. So a row's clickability is decided entirely by
 * whether the surface accepts the exact string the producer emitted — down to the query parameter
 * NAMES. Rename `session` to `sessionId` on the surface and every session row in the drawer goes
 * quietly dead, with no type error and no failing test: the two sides live in different packages
 * and never met.
 *
 * They were agreeing only by a comment. `source-refs.test.ts` in apps/api pins these same literals
 * from the producer end and points at `FileTab.surface.ts` in prose; this pins the other end against
 * the real surface modules. Between them the string is locked from both directions.
 *
 * Surfaces are plain modules (`{ uri, params, resolve }`), so this needs no registry and no DOM —
 * the runtime registry only decides whether a surface is MOUNTED, never whether the URI parses.
 *
 * Lives in the widget layer rather than beside the drawer because it has to import BOTH surfaces,
 * and `check:architecture` correctly refuses a feature that reaches outward into widgets.
 */
describe('source URIs resolve on the surfaces that own them', () => {
  test('a file source opens the file tab, at its line', () => {
    // Byte-for-byte what `fileSource({ path: 'src/a.ts', line: 42 })` returns.
    const parsed = parseLocalixUri('localix://ui/work-item/file?path=src%2Fa.ts&line=42')!

    expect(`localix://${parsed.primitive}/${parsed.breadcrumbs.join('/')}`).toBe(fileSurface.uri)
    expect(
      fileSurface.resolve({
        path: parsed.query.get('path')!,
        line: Number(parsed.query.get('line')),
      }),
    ).toEqual({ kind: 'file', path: 'src/a.ts', line: 42 })
  })

  test('a file source without a line still opens the file', () => {
    // The `line` key is omitted entirely rather than sent as 0 — see the producer's own test.
    // `query` is a URLSearchParams, so an absent key reads as null, never undefined.
    const parsed = parseLocalixUri('localix://ui/work-item/file?path=src%2Fa.ts')!

    expect(parsed.query.get('line')).toBeNull()
    expect(fileSurface.resolve({ path: parsed.query.get('path')! })).toMatchObject({
      kind: 'file',
      path: 'src/a.ts',
    })
  })

  test('a session source opens that session', () => {
    // Byte-for-byte what `sessionSource({ sessionId: 'LOCALIX-9' })` returns.
    const parsed = parseLocalixUri('localix://ui/work-item/chat?session=LOCALIX-9')!

    expect(`localix://${parsed.primitive}/${parsed.breadcrumbs.join('/')}`).toBe(chatSurface.uri)
    expect(chatSurface.resolve({ session: parsed.query.get('session')! })).toEqual({
      kind: 'session',
      sessionId: 'LOCALIX-9',
    })
  })

  test('both surfaces declare the parameters the producers actually send', () => {
    // The failure this catches is a RENAME, which resolve() alone would not: a surface that dropped
    // `path` would simply resolve to something else rather than refusing.
    expect(Object.keys(fileSurface.params ?? {})).toContain('path')
    expect(Object.keys(fileSurface.params ?? {})).toContain('line')
    expect(Object.keys(chatSurface.params ?? {})).toContain('session')
  })
})
