import { describe, expect, test } from 'bun:test'
import { linksInText } from './contextLinks'

describe('links written as text', () => {
  test('every kind of token becomes the binding a drag of it carries', () => {
    const { links, onlyLinks } = linksInText(
      '@file:src/a.ts @session:LOCALIX-42 @call:tc_1 @terminal:abcd1234 @message:s1/m2',
    )
    expect(onlyLinks).toBe(true)
    expect(links.map((link) => link.target.kind)).toEqual([
      'file',
      'session',
      'call',
      'terminal',
      'message',
    ])
    expect(links[0]?.target.attributes?.path).toBe('src/a.ts')
    expect(links[1]?.target).toMatchObject({
      token: '@session:LOCALIX-42',
      attributes: { sessionId: 'LOCALIX-42' },
    })
    expect(links[4]?.target.attributes).toMatchObject({ sessionId: 's1', messageId: 'm2' })
  })

  test('a resource, as a token or as a bare localix:// URI, is the same resource', () => {
    const uri = 'localix://resource/database/conn-1/public/users'
    const token = linksInText(`@resource:${uri}`).links[0]?.target
    const bare = linksInText(uri).links[0]?.target
    expect(token).toMatchObject({ kind: 'resource', uri })
    expect(bare).toEqual(token)
  })

  test('a typed folder is the folder a dragged tree row is: a file path ending in /', () => {
    expect(linksInText('@folder:src/lib').links[0]?.target).toMatchObject({
      kind: 'file',
      attributes: { path: 'src/lib/' },
    })
  })

  test('prose around links is noticed, a repeated link is taken once', () => {
    const { links, onlyLinks } = linksInText('see @file:a.ts and @file:a.ts.')
    expect(links).toHaveLength(1)
    expect(onlyLinks).toBe(false)
    expect(linksInText('just words').links).toEqual([])
  })
})
