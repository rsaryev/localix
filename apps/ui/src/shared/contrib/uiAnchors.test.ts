import { describe, expect, test } from 'bun:test'
import type { UiAnchorContribution } from '@localixai/mini-app-sdk/ui'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import { createUiAnchorRegistry } from './uiAnchors'

const contribution = (id: string, namespace: string): UiAnchorContribution => ({
  id,
  namespaces: [namespace],
  resolve: (uri) =>
    uri === localixResourceUri(namespace, ['item'])
      ? { kind: 'work-item', workKind: id, id: `${id}:item`, title: id }
      : null,
  listChildren: (parent) =>
    parent === null
      ? [{ uri: localixResourceUri(namespace, ['item']), label: id, hasChildren: false }]
      : [],
})

describe('UiAnchorRegistry', () => {
  test('dispatches directly to the Localix namespace owner', () => {
    const registry = createUiAnchorRegistry()
    expect(registry.register(contribution('container', 'fixture-container'))).toBe(true)
    expect(registry.register(contribution('catalog', 'fixture-db'))).toBe(true)
    expect(registry.resolve('localix://resource/fixture-container/item')).toMatchObject({
      workKind: 'container',
    })
    expect(registry.resolve('unknown://item')).toBeNull()
  })

  test('rejects duplicate ids and namespace ownership atomically', () => {
    const registry = createUiAnchorRegistry()
    const first = contribution('one', 'same')
    expect(registry.register(first)).toBe(true)
    expect(registry.register(first)).toBe(true)
    expect(registry.register(contribution('one', 'other'))).toBe(false)
    expect(registry.register(contribution('two', 'same'))).toBe(false)
    expect(registry.owner('same')).toBe(first)
    expect(registry.owner('other')).toBeUndefined()
  })

  test('lists every owner at root and only the matching owner below it', () => {
    const registry = createUiAnchorRegistry()
    registry.register(contribution('A', 'a'))
    registry.register(contribution('B', 'b'))
    expect(registry.listChildren(null).map((node) => node.label)).toEqual(['A', 'B'])
    expect(registry.listChildren(localixResourceUri('a', ['item']))).toEqual([])
  })
})
