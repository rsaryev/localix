import { describe, expect, it } from 'bun:test'
import { resourceActionRows } from './resourceActions'
import type { ResourceNode } from '@/shared/api/contracts'

const link = (uri: string) =>
  uri.startsWith('localix://resource/chat/session/')
    ? `@session:${uri.slice('localix://resource/chat/session/'.length)}`
    : `@resource:${uri}`

const node = (over: Partial<ResourceNode>): ResourceNode => ({
  uri: 'localix://resource/git/P/commits/abc',
  label: 'a commit',
  hasChildren: true,
  ...over,
})

describe('resourceActionRows', () => {
  it('roots (no container) → no action rows', () => {
    expect(resourceActionRows(null, null, link)).toEqual([])
  })

  it('drilled container with no declared actions → default "Link this here"', () => {
    const rows = resourceActionRows(
      'localix://resource/git/P/branches',
      node({ uri: 'localix://resource/git/P/branches', actions: undefined }),
      link,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('Link this here')
    expect(rows[0].insert).toBe('@resource:localix://resource/git/P/branches')
  })

  it('drilled container with a cold cache (unknown node) still gets the default link', () => {
    const rows = resourceActionRows('localix://resource/git/P/commits/abc', null, link)
    expect(rows).toHaveLength(1)
    expect(rows[0].insert).toBe('@resource:localix://resource/git/P/commits/abc')
  })

  it('provider-declared actions win (nicer verb) and link the container uri', () => {
    const rows = resourceActionRows(
      'localix://resource/git/P/commits/abc',
      node({ actions: [{ id: 'link', label: 'Link this commit', kind: 'link' }] }),
      link,
    )
    expect(rows.map((r) => r.label)).toEqual(['Link this commit'])
    expect(rows[0].insert).toBe('@resource:localix://resource/git/P/commits/abc')
    expect(rows[0].id).toBe('localix://resource/git/P/commits/abc#link')
  })

  it('links a localix://resource/chat/ container as its native token via linkToken', () => {
    const rows = resourceActionRows(
      'localix://resource/chat/session/LOCALIX-9',
      node({ uri: 'localix://resource/chat/session/LOCALIX-9' }),
      link,
    )
    expect(rows[0].insert).toBe('@session:LOCALIX-9')
  })
})
