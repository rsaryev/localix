import { describe, expect, test } from 'bun:test'
import type { MessageAttachment } from '@/shared/api/contracts'
import { messageAttachmentKeys } from './MessageAttachments'

const image = (name: string, mediaId?: string): MessageAttachment => ({
  kind: 'image',
  mediaType: 'image/png',
  mediaId,
  data: mediaId ? undefined : `inline-${name}`,
  name,
  size: name.length,
})

describe('messageAttachmentKeys', () => {
  test('keeps different attachment identities stable when their order changes', () => {
    const first = image('first.png', 'media-1')
    const second = image('second.png', 'media-2')

    expect(messageAttachmentKeys([first, second])).toEqual([
      'image:media:media-1',
      'image:media:media-2',
    ])
    expect(messageAttachmentKeys([second, first])).toEqual([
      'image:media:media-2',
      'image:media:media-1',
    ])
  })

  test('disambiguates exact inline duplicates without using list position for other assets', () => {
    const duplicate = image('same.png')
    const keys = messageAttachmentKeys([duplicate, duplicate, image('other.png')])

    expect(keys[0]).not.toBe(keys[1])
    expect(keys[1]).toEndWith(':duplicate-2')
    expect(keys[2]).toContain('other.png')
  })
})
