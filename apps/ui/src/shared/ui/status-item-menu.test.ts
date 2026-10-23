import { describe, expect, test } from 'bun:test'
import type { MenuEntry, StatusItemState } from '@localixai/mini-app-sdk/ui'

import { isMenuAction } from '@localixai/kit/menu-entries'
import { statusItemMenuEntries } from './status-item-menu'

const host = { openMiniAppSettings: () => undefined }
const labels = (entries: MenuEntry[]) =>
  entries.map((entry) =>
    'separator' in entry ? '—' : 'header' in entry ? `#${entry.header}` : entry.label,
  )

const state = (partial: Partial<StatusItemState> & { label: string }): StatusItemState => partial

describe('the uniform status-item menu', () => {
  test('an item that declared nothing still has a menu', () => {
    // The failure this fixes: a mini app glyph where right-click did nothing, which reads exactly
    // like a mini app that broke. Every item answers, and the answer says where to configure it.
    expect(labels(statusItemMenuEntries(state({ label: 'Reader' }), host))).toEqual([
      'Mini app settings…',
    ])
  })

  test('an item with only a click gets that click as its first row', () => {
    let opened = 0
    const entries = statusItemMenuEntries(
      state({ label: 'Open Reader', onClick: () => (opened += 1) }),
      host,
    )
    expect(labels(entries)).toEqual(['Open Reader', '—', 'Mini app settings…'])
    const primary = entries[0]
    if (!primary || !isMenuAction(primary)) throw new Error('expected an action row')
    primary.onSelect()
    expect(opened).toBe(1)
  })

  test('a mini app’s own entries come first, and the host never duplicates them', () => {
    // Every mini app that declares a menu opens it with its own "Open …" row. A synthesised primary
    // on top would say the same thing twice in the app's most repeated menu.
    const entries = statusItemMenuEntries(
      state({
        label: 'DevOps — 2 port-forwards running',
        onClick: () => undefined,
        menu: [
          { id: 'open', label: 'Open port forwards', onSelect: () => undefined },
          { separator: true },
          { id: 'stop', label: 'Stop 127.0.0.1:5432', danger: true, onSelect: () => undefined },
        ],
      }),
      host,
    )
    expect(labels(entries)).toEqual([
      'Open port forwards',
      '—',
      'Stop 127.0.0.1:5432',
      '—',
      'Mini app settings…',
    ])
  })

  test('the host row is last on every item, whatever the mini app declared', () => {
    for (const item of [
      state({ label: 'bare' }),
      state({ label: 'clickable', onClick: () => undefined }),
      state({ label: 'menued', menu: [{ id: 'a', label: 'A', onSelect: () => undefined }] }),
    ]) {
      const entries = statusItemMenuEntries(item, host)
      expect(labels(entries).at(-1)).toBe('Mini app settings…')
    }
  })

  test('the host row runs the host capability, not a mini app one', () => {
    let opened = 0
    const entries = statusItemMenuEntries(state({ label: 'x' }), {
      openMiniAppSettings: () => (opened += 1),
    })
    const row = entries.at(-1)
    if (!row || !isMenuAction(row)) throw new Error('expected an action row')
    row.onSelect()
    expect(opened).toBe(1)
  })

  test('a menu never opens or ends with a separator', () => {
    for (const item of [
      state({ label: 'bare' }),
      state({ label: 'clickable', onClick: () => undefined }),
      state({ label: 'menued', menu: [{ id: 'a', label: 'A', onSelect: () => undefined }] }),
    ]) {
      const entries = statusItemMenuEntries(item, host)
      expect('separator' in entries[0]!).toBe(false)
      expect('separator' in entries.at(-1)!).toBe(false)
    }
  })
})
