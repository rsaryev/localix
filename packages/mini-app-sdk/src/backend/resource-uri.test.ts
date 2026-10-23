import { describe, expect, test } from 'bun:test'
import { localixUriNamespace } from '../resource'
import {
  buildResourceUri,
  decodeResourceSegment,
  encodeResourceSegment,
  parseResourceUri,
  resourceDrillPartial,
  resourceNav,
  resourceParentPartial,
  providerSegments,
} from './resource-uri'

describe('resource URI primitives', () => {
  test('navigates provider roots, containers, and in-progress segments', () => {
    expect(resourceNav('')).toEqual({ parent: null, segment: '', provider: null })
    expect(resourceNav(buildResourceUri('db'))).toEqual({
      parent: null,
      segment: '',
      provider: 'db',
    })
    expect(resourceNav(`${buildResourceUri('db', ['main', 'public'])}/`)).toEqual({
      parent: buildResourceUri('db', ['main', 'public']),
      segment: '',
      provider: 'db',
    })
    expect(resourceNav(buildResourceUri('db', ['main', 'pub']))).toEqual({
      parent: buildResourceUri('db', ['main']),
      segment: 'pub',
      provider: 'db',
    })

    expect(resourceDrillPartial(buildResourceUri('db'))).toBe(`${buildResourceUri('db')}/`)
    expect(resourceDrillPartial(buildResourceUri('db', ['main']))).toBe(
      `${buildResourceUri('db', ['main'])}/`,
    )
    expect(resourceParentPartial(`${buildResourceUri('db', ['main', 'public'])}/`)).toBe(
      `${buildResourceUri('db', ['main'])}/`,
    )
    expect(resourceParentPartial(buildResourceUri('db', ['main', 'pub']))).toBe(
      `${buildResourceUri('db', ['main'])}/`,
    )
  })

  test('round-trips segments that collide with token punctuation and path syntax', () => {
    for (const segment of ['my data', 'a/b', 'orders(archive).', '日本語']) {
      const encoded = encodeResourceSegment(segment)
      expect(encoded).not.toContain('/')
      expect(decodeResourceSegment(encoded)).toBe(segment)
    }
    expect(decodeResourceSegment('%not-hex')).toBe('%not-hex')
  })

  test('parses and provider-guards opaque resource identities', () => {
    expect(parseResourceUri(buildResourceUri('db', ['main', 'public', 'orders']))).toEqual({
      provider: 'db',
      rest: 'main/public/orders',
      segments: ['main', 'public', 'orders'],
    })
    expect(parseResourceUri('not-a-resource')).toBeNull()
    expect(providerSegments('db', buildResourceUri('db', ['main', 'public']))).toEqual([
      'main',
      'public',
    ])
    expect(providerSegments('git', buildResourceUri('db', ['main', 'public']))).toBeNull()
    expect(parseResourceUri('db://main/public')).toBeNull()
    expect(parseResourceUri('localix://ui/db/main/public')).toBeNull()
    expect(parseResourceUri(`${buildResourceUri('db', ['main'])}/`)).toBeNull()
    expect(parseResourceUri(`${buildResourceUri('db')}//main`)).toBeNull()
  })

  test('extracts the first breadcrumb for generic resource and UI dispatch', () => {
    expect(localixUriNamespace(buildResourceUri('docker', ['containers']))).toBe('docker')
    expect(localixUriNamespace('localix://ui/settings/plugins')).toBe('settings')
    expect(localixUriNamespace('localix://ui/page/chat')).toBe('page')
    expect(localixUriNamespace('db://main')).toBeNull()
  })
})
