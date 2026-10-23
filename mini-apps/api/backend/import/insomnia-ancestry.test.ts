import { describe, expect, test } from 'bun:test'
import { convertInsomniaExport } from './insomnia'

const request = {
  _id: 'request',
  _type: 'request',
  name: 'Read',
  url: 'https://api.test',
  authentication: {},
}
const convert = (resources: unknown[]) =>
  convertInsomniaExport(JSON.stringify({ __export_format: 4, resources }))!

describe('Insomnia resource ancestry boundaries', () => {
  test('uses the last resource for a duplicate parent ID while preserving request order', () => {
    const out = convert([
      {
        _id: 'group',
        _type: 'request_group',
        name: 'Old',
        authentication: { type: 'bearer', token: 'old' },
      },
      { ...request, parentId: 'group', name: 'First' },
      {
        _id: 'group',
        _type: 'request_group',
        name: 'New',
        authentication: { type: 'bearer', token: 'new' },
      },
      { ...request, _id: 'second', parentId: 'group', name: 'Second' },
    ])
    expect(out.requests.map((entry) => entry.name)).toEqual(['new-first', 'new-second'])
    expect(out.requests.map((entry) => entry.spec.auth)).toEqual([
      { type: 'bearer', token: 'new' },
      { type: 'bearer', token: 'new' },
    ])
  })

  test('stops after twenty ancestors consistently for names, headers and auth', () => {
    const groups = Array.from({ length: 23 }, (_, index) => ({
      _id: `g${index}`,
      _type: 'request_group',
      parentId: index ? `g${index - 1}` : null,
      name: `G${index}`,
      headers: [{ name: 'Accept', value: String(index) }],
      ...(index === 2 ? { authentication: { type: 'bearer', token: 'beyond-cap' } } : {}),
    }))
    const out = convert([...groups, { ...request, parentId: 'g22' }])
    const included = groups.slice(3)
    expect(out.requests[0]!.name).toBe(
      `${included.map((g) => g.name.toLowerCase()).join('-')}-read`,
    )
    expect(out.requests[0]!.spec.headers).toEqual([
      { name: 'Accept', value: included.map((g) => g.headers[0]!.value).join(', ') },
    ])
    expect(out.requests[0]!.spec.auth).toEqual({ type: 'none' })
  })

  test('records unsupported auth nearest first while continuing to a usable ancestor', () => {
    const out = convert([
      {
        _id: 'workspace',
        _type: 'workspace',
        authentication: { type: 'basic', username: 'ada', password: 'p' },
      },
      {
        _id: 'group',
        _type: 'request_group',
        parentId: 'workspace',
        authentication: { type: 'digest' },
      },
      { ...request, parentId: 'group', authentication: { type: 'oauth2' } },
    ])
    expect(out.notes.unsupportedAuth).toEqual(['oauth2', 'digest'])
    expect(out.requests[0]!.spec.auth).toEqual({ type: 'basic', username: 'ada', password: 'p' })
  })
})
