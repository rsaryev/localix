import { describe, expect, it } from 'bun:test'
import type { ResourceNode } from '@/shared/api/contracts'
import { flattenResourceBrowse } from '@localixai/api/context-refs'
import {
  buildCallRows,
  buildRefPathRows,
  buildResourceRows,
  buildSearchHitRows,
  buildSessionRows,
  buildTerminalRows,
  buildTypeRows,
  rowsOwnedBy,
} from './atRefSuggestions'

describe('buildTypeRows', () => {
  it('offers every typeable kind for a bare @, filtered by keyword prefix', () => {
    expect(buildTypeRows('').length).toBeGreaterThan(5)
    expect(buildTypeRows('fo').map((r) => r.label)).toEqual(['@folder:'])
    expect(buildTypeRows('zzz')).toEqual([])
  })
})

describe('rowsOwnedBy', () => {
  it('hides stale async rows when their directory/session owner changes', () => {
    const rows = [{ id: 'old' }]
    expect(rowsOwnedBy(rows, 'old-scope', 'new-scope')).toEqual([])
    expect(rowsOwnedBy(rows, 'same-scope', 'same-scope')).toBe(rows)
  })
})

describe('buildSessionRows', () => {
  const sessions = [
    { id: 'LOCALIX-1', title: 'Fix the parser' },
    { id: 'LOCALIX-2', title: 'Ship the menu' },
  ]
  it('excludes the active session and matches by title or id', () => {
    expect(buildSessionRows(sessions, '', 'LOCALIX-1').map((r) => r.sessionId)).toEqual([
      'LOCALIX-2',
    ])
    expect(buildSessionRows(sessions, 'parser', null)[0]?.sessionId).toBe('LOCALIX-1')
  })
})

describe('buildTerminalRows', () => {
  it('matches by id prefix or command and shortens the inserted id', () => {
    const rows = buildTerminalRows([{ terminalId: 'abcdef1234', command: 'vim', cwd: '/w' }], 'vi')
    expect(rows[0]?.insertToken).toBe('@terminal:abcdef12')
  })
})

describe('buildCallRows', () => {
  it('walks the transcript newest-first, dedupes by toolCallId, marks failures', () => {
    const rows = buildCallRows(
      [
        { items: [{ toolCallId: 'c1', name: 'Read', status: 'completed' }] },
        {
          items: [
            { toolCallId: 'c2', name: 'Bash', status: 'failed' },
            { toolCallId: 'c1', name: 'Read' },
          ],
        },
      ],
      '',
    )
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(rows[1]?.label).toBe('Bash (failed)')
  })
})

describe('buildResourceRows', () => {
  const nodes: ResourceNode[] = [
    {
      uri: 'localix://resource/fixture-db/c1',
      label: 'local pg',
      hasChildren: true,
      group: 'Databases',
    },
    {
      uri: 'localix://resource/fixture-db/c1/notice',
      label: 'truncated',
      hasChildren: false,
      notice: true,
    } as ResourceNode,
  ]
  it('drops notice rows, matches roots by group, heads a drilled level with actions', () => {
    const linkToken = (uri: string) => `@resource:${uri}`
    const atRoots = buildResourceRows({
      nodes,
      segment: 'data',
      parent: null,
      container: null,
      linkToken,
    })
    expect(atRoots.map((r) => r.uri)).toEqual(['localix://resource/fixture-db/c1']) // group match, notice dropped
    const drilled = buildResourceRows({
      nodes,
      segment: '',
      parent: 'localix://resource/fixture-db/c1',
      container: nodes[0],
      linkToken,
    })
    expect(drilled[0]?.isAction).toBe(true)
    expect(drilled[0]?.actionInsert).toBe('@resource:localix://resource/fixture-db/c1')
  })

  it('renders backend category roots as rows rather than duplicated section headers', () => {
    const backendRows = flattenResourceBrowse({
      version: 1,
      partial: '',
      parent: null,
      provider: null,
      segment: '',
      groups: [
        {
          id: 'db:databases',
          provider: 'db',
          label: 'Databases',
          resources: [
            {
              uri: 'localix://resource/fixture-db',
              label: 'Databases',
              hasChildren: true,
              navigationOnly: true,
            },
          ],
        },
        {
          id: 'git:repositories',
          provider: 'git',
          label: 'Repositories',
          resources: [
            {
              uri: 'localix://resource/git',
              label: 'Repositories',
              hasChildren: true,
              navigationOnly: true,
            },
          ],
        },
      ],
      notices: [],
      total: 2,
      truncated: false,
    })
    const rows = buildResourceRows({
      nodes: backendRows,
      segment: '',
      parent: null,
      container: null,
      linkToken: (uri) => `@resource:${uri}`,
    })
    expect(rows.map((row) => [row.resourceGroup, row.uri, row.navigationOnly])).toEqual([
      [undefined, 'localix://resource/fixture-db', true],
      [undefined, 'localix://resource/git', true],
    ])
  })
})

describe('buildRefPathRows', () => {
  it('lists a whole directory on an empty segment and heads it with Link this folder', () => {
    const rows = buildRefPathRows({
      entries: [
        { name: 'lib', type: 'dir' },
        { name: 'a.ts', type: 'file' },
      ],
      dirPart: 'src/',
      segment: '',
      wantDirsOnly: false,
    })
    expect(rows[0]?.actionInsert).toBe('@folder:src')
    expect(rows.slice(1).map((r) => r.label)).toEqual(['lib/', 'a.ts'])
  })
  it('fuzzy-filters by the typed segment and can restrict to directories', () => {
    const entries = [
      { name: 'lib', type: 'dir' as const },
      { name: 'a.ts', type: 'file' as const },
    ]
    expect(
      buildRefPathRows({ entries, dirPart: '', segment: 'li', wantDirsOnly: false }).map(
        (r) => r.label,
      ),
    ).toEqual(['lib/'])
    expect(
      buildRefPathRows({ entries, dirPart: '', segment: '', wantDirsOnly: true }).map(
        (r) => r.label,
      ),
    ).toEqual(['lib/'])
  })
})

describe('buildSearchHitRows', () => {
  it('maps hits with the requested kind and a parent-dir description', () => {
    const rows = buildSearchHitRows(
      [{ path: 'src/app/main.ts', name: 'main.ts', type: 'file' }],
      'mention',
    )
    expect(rows[0]).toMatchObject({
      kind: 'mention',
      path: 'src/app/main.ts',
      description: 'src/app',
    })
  })
})
