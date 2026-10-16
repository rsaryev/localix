import { describe, expect, test } from 'bun:test'

import { openProjectSwitcher, subscribeChatChrome } from './chatChromeBus'
import {
  beginNewFile,
  focusTreeSearch,
  revealInTree,
  subscribeNewFile,
  subscribeRevealInTree,
  subscribeTreeSearch,
} from './explorerBus'
import { onFilesReloaded, publishFilesReloaded } from './fileReloadBus'
import { runMenuCommand, subscribeMenuCommands } from './menuBus'
import { openModelPicker, subscribeModelPicker } from './modelPickerBus'
import { openNotificationCenter, subscribeNotificationCenter } from './notificationCenterBus'
import { openSidebarSection, subscribeSidebarSection } from './sidebarSectionBus'

type Listener = (...args: unknown[]) => void

const channels: Array<{
  name: string
  subscribe: (listener: Listener) => () => void
  publish: () => void
  args: unknown[]
}> = [
  {
    name: 'chat chrome',
    subscribe: subscribeChatChrome,
    publish: openProjectSwitcher,
    args: ['project-switcher'],
  },
  {
    name: 'explorer reveal',
    subscribe: subscribeRevealInTree,
    publish: () => revealInTree('/workspace/source.ts'),
    args: ['/workspace/source.ts'],
  },
  {
    name: 'explorer search',
    subscribe: subscribeTreeSearch,
    publish: () => focusTreeSearch('content'),
    args: ['content'],
  },
  { name: 'new file', subscribe: subscribeNewFile, publish: beginNewFile, args: [] },
  {
    name: 'file reload',
    subscribe: onFilesReloaded,
    publish: () => publishFilesReloaded(['/workspace/source.ts', '/workspace/source.ts']),
    args: [new Set(['/workspace/source.ts'])],
  },
  {
    name: 'native menu',
    subscribe: subscribeMenuCommands,
    publish: () => runMenuCommand('save_file'),
    args: ['save_file'],
  },
  {
    name: 'model picker',
    subscribe: subscribeModelPicker,
    publish: () => openModelPicker({ sessionId: 'chat-1', query: 'model' }),
    args: [{ sessionId: 'chat-1', query: 'model' }],
  },
  {
    name: 'notification center',
    subscribe: subscribeNotificationCenter,
    publish: () => openNotificationCenter('entry-1'),
    args: ['entry-1'],
  },
  {
    name: 'sidebar',
    subscribe: subscribeSidebarSection,
    publish: () => openSidebarSection(null),
    args: [null],
  },
]

for (const channel of channels) {
  describe(channel.name, () => {
    test('drops unobserved requests and delivers once per listener in subscription order', () => {
      channel.publish()
      const seen: Array<{ owner: string; args: unknown[] }> = []
      const first: Listener = (...args) => seen.push({ owner: 'first', args })
      const stopFirst = channel.subscribe(first)
      const stopDuplicate = channel.subscribe(first)
      const stopSecond = channel.subscribe((...args) => seen.push({ owner: 'second', args }))
      try {
        expect(seen).toEqual([])
        channel.publish()
        expect(seen).toEqual([
          { owner: 'first', args: channel.args },
          { owner: 'second', args: channel.args },
        ])
        stopDuplicate()
        channel.publish()
        expect(seen.at(-1)).toEqual({ owner: 'second', args: channel.args })
        expect(seen).toHaveLength(3)
      } finally {
        stopFirst()
        stopDuplicate()
        stopSecond()
      }
    })

    test('honors removals and new subscribers during the same delivery', () => {
      const seen: string[] = []
      let stopLate = () => {}
      const stopFirst = channel.subscribe(() => {
        seen.push('first')
        stopSecond()
        stopLate = channel.subscribe(() => seen.push('late'))
      })
      const stopSecond = channel.subscribe(() => seen.push('second'))
      try {
        channel.publish()
        expect(seen).toEqual(['first', 'late'])
      } finally {
        stopFirst()
        stopSecond()
        stopLate()
      }
    })

    test('propagates an owner error and stops the current delivery', () => {
      const error = new Error('owner failed')
      const seen: string[] = []
      const stopFirst = channel.subscribe(() => {
        throw error
      })
      const stopSecond = channel.subscribe(() => seen.push('second'))
      try {
        expect(channel.publish).toThrow(error)
        expect(seen).toEqual([])
      } finally {
        stopFirst()
        stopSecond()
      }
    })
  })
}

test('file reload skips empty requests and shares one deduplicated path set', () => {
  const seen: ReadonlySet<string>[] = []
  const stopFirst = onFilesReloaded((paths) => seen.push(paths))
  const stopSecond = onFilesReloaded((paths) => seen.push(paths))
  try {
    publishFilesReloaded([])
    expect(seen).toEqual([])
    publishFilesReloaded(['/workspace/a.ts', '/workspace/a.ts', '/workspace/b.ts'])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    expect([...seen[0]!]).toEqual(['/workspace/a.ts', '/workspace/b.ts'])
  } finally {
    stopFirst()
    stopSecond()
  }
})
