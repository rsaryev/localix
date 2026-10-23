import { beforeEach, expect, test } from 'bun:test'

import { consumeSettingsNav, navigateSettings, subscribeSettingsNav } from './settingsNavBus'

// The bus latches the last navigation for a late subscriber; one left by another file in the same
// process would replay into these assertions.
beforeEach(() => {
  consumeSettingsNav()
})

test('settings navigation carries an exact capability scope and plugin anchor', () => {
  const received: unknown[] = []
  const unsubscribe = subscribeSettingsNav((target) => received.push(target))
  try {
    navigateSettings('plugins', 'plugin-sample-plugin', 'project-a')
    expect(received).toEqual([
      { tab: 'plugins', anchor: 'plugin-sample-plugin', scope: 'project-a' },
    ])
  } finally {
    consumeSettingsNav()
    unsubscribe()
  }
})

test('consuming the latch inside one listener does not erase the event for later listeners', () => {
  const received: unknown[] = []
  const stopFirst = subscribeSettingsNav(() => consumeSettingsNav())
  const stopSecond = subscribeSettingsNav((target) => received.push(target))
  try {
    navigateSettings('tools', 'tool-sample', 'project-a')
    expect(received).toEqual([
      { tab: 'tools', anchor: 'tool-sample', scope: 'project-a', entryId: undefined },
    ])
  } finally {
    consumeSettingsNav()
    stopFirst()
    stopSecond()
  }
})
