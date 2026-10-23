import { describe, expect, test } from 'bun:test'

import { normalizeAgentSources } from '@localixai/agent/agents'
import {
  discoveredFileSource,
  fileOpenMarkdownLink,
  fileSource,
  fileUiUri,
  sessionSource,
} from './source-refs'

describe('source refs', () => {
  test('a file source points at the workbench URI the file tab already registers', () => {
    // Not an invented scheme: `FileTab.surface.ts` declares `localix://ui/work-item/file` with
    // exactly these two params, which is what makes the row clickable with no new navigation.
    expect(fileSource({ path: 'src/a.ts', line: 42 })).toMatchObject({
      kind: 'file',
      title: 'a.ts',
      uri: 'localix://ui/work-item/file?path=src%2Fa.ts&line=42',
      role: 'consulted',
      status: 'available',
    })
  })

  test('a trailing slash still yields a name, never an empty row', () => {
    // `read` on a DIRECTORY publishes through the same funnel, and a directory path may arrive
    // with a trailing separator — `'src/dir/'.split('/')` ends in an empty segment. Without the
    // filter the row would render with a blank label, which reads as a bug in the drawer rather
    // than as a directory. Found by mutation: removing the filter broke nothing.
    expect(fileSource({ path: 'src/dir/' }).title).toBe('dir')
    expect(fileSource({ path: '/' }).title).toBe('/')
  })

  test('a line is omitted rather than sent as zero or empty', () => {
    expect(fileSource({ path: 'src/a.ts' }).uri).toBe('localix://ui/work-item/file?path=src%2Fa.ts')
    expect(fileSource({ path: 'src/a.ts', line: 0 }).uri).toBe(
      'localix://ui/work-item/file?path=src%2Fa.ts',
    )
  })

  test('paths with spaces, hashes and query characters survive the round trip', () => {
    const path = 'src/my notes/a#b?c.ts'
    const uri = fileSource({ path }).uri
    expect(new URL(uri).searchParams.get('path')).toBe(path)
  })

  test('a model-facing file link reuses the same canonical destination', () => {
    const path = '/Users/me/My [final] report.pdf'
    expect(fileOpenMarkdownLink(path)).toBe(
      '[My \\[final\\] report.pdf](localix://ui/work-item/file?path=%2FUsers%2Fme%2FMy+%5Bfinal%5D+report.pdf)',
    )
    expect(fileUiUri({ path, line: 9 })).toBe(fileSource({ path, line: 9 }).uri)
  })

  test('a search hit is DISCOVERED, never consulted', () => {
    // The context-system document rejects "treating discovery snippets as consulted evidence".
    // A grep hit proves a string exists, not that the agent read the file.
    expect(discoveredFileSource({ path: 'src/a.ts', line: 7 }).role).toBe('discovered')
    expect(fileSource({ path: 'src/a.ts', line: 7 }).role).toBe('consulted')
  })

  test('a session source opens that session', () => {
    expect(sessionSource({ sessionId: 'LOCALIX-9', title: 'Audit auth' })).toMatchObject({
      kind: 'session',
      title: 'Audit auth',
      uri: 'localix://ui/work-item/chat?session=LOCALIX-9',
      role: 'consulted',
    })
  })

  test('a session with no usable title falls back to its id, never to an empty row', () => {
    expect(sessionSource({ sessionId: 'LOCALIX-9', title: '   ' }).title).toBe('LOCALIX-9')
    expect(sessionSource({ sessionId: 'LOCALIX-9' }).title).toBe('LOCALIX-9')
  })

  test('the same place gets the same id, different places different ids', () => {
    expect(fileSource({ path: 'src/a.ts', line: 1 }).id).toBe(
      fileSource({ path: 'src/a.ts', line: 1 }).id,
    )
    expect(fileSource({ path: 'src/a.ts', line: 1 }).id).not.toBe(
      fileSource({ path: 'src/a.ts', line: 2 }).id,
    )
  })

  test('no source carries a snippet', () => {
    // Deliberate: the title and URI say everything a row needs, and a snippet per read would
    // inflate payload_json and the WS snapshot on exactly the read-heavy sessions where it hurts.
    for (const source of [
      fileSource({ path: 'src/a.ts' }),
      sessionSource({ sessionId: 'LOCALIX-9' }),
    ]) {
      expect(source.snippet).toBeUndefined()
    }
  })

  test('every builder survives the coercion boundary unchanged', () => {
    // Everything a tool returns passes `normalizeAgentSources` before it reaches an item. A
    // builder that produced a record the validator drops would publish nothing, silently.
    const built = [
      fileSource({ path: 'src/a.ts', line: 3 }),
      discoveredFileSource({ path: 'src/b.ts' }),
      sessionSource({ sessionId: 'LOCALIX-9' }),
    ]

    expect(normalizeAgentSources(built)).toHaveLength(built.length)
  })
})
