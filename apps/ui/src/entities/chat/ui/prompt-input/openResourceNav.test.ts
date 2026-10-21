import { describe, expect, test } from 'bun:test'
import { resourceBreadcrumbs } from './openResourceNav'

describe('resourceBreadcrumbs', () => {
  test('builds cumulative opaque URI anchors', () => {
    expect(resourceBreadcrumbs('localix://ui/settings/editor/editor-on-save')).toEqual([
      { uri: null, label: 'Resources' },
      { uri: 'localix://ui/settings/editor', label: 'editor' },
      { uri: 'localix://ui/settings/editor/editor-on-save', label: 'editor-on-save' },
    ])
  })

  test('uses provider labels already observed while drilling', () => {
    const known = new Map([
      [
        'localix://resource/fixture-db/c1',
        {
          uri: 'localix://resource/fixture-db/c1',
          label: 'Local database',
          hasChildren: true,
        },
      ],
    ])
    expect(resourceBreadcrumbs('localix://resource/fixture-db/c1/public', known)).toEqual([
      { uri: null, label: 'Resources' },
      { uri: 'localix://resource/fixture-db', label: 'fixture-db' },
      { uri: 'localix://resource/fixture-db/c1', label: 'Local database' },
      { uri: 'localix://resource/fixture-db/c1/public', label: 'public' },
    ])
  })

  test('does not mint clickable crumbs from legacy provider schemes', () => {
    expect(resourceBreadcrumbs('db://c1/public')).toEqual([{ uri: null, label: 'Resources' }])
  })
})
