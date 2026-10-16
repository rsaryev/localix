import { afterEach, describe, expect, test } from 'bun:test'

import {
  syncThirdPartyViews,
  subscribeThirdPartyViews,
  thirdPartyViewsVersion,
  listThirdPartyViews,
  __resetThirdPartyViews,
} from './runtimeViews'
import type { PluginViewSpec } from '@/shared/api/contracts'
import { listUiLocations, resolveUiLocation } from './uiLocations'
import { setEnabledPluginNames } from './pluginActivation'

/**
 * The RUNTIME third-party UI discovery store: fetched-view specs registered as
 * removable work-item entries. Unlike the static bundled glob, a plugin that drops
 * out of a later sync is GONE — the removal contract phase 2 needs.
 */

const view = (pluginName: string, id: string): PluginViewSpec => ({
  pluginName,
  projectId: '',
  id,
  fullName: `${pluginName}:${id}`,
  title: id,
})

afterEach(() => {
  __resetThirdPartyViews()
  setEnabledPluginNames(null)
})

describe('syncThirdPartyViews', () => {
  test('registers every view as a work-item destination — there is no other placement', () => {
    setEnabledPluginNames(new Set(['mon']))
    syncThirdPartyViews([view('mon', 'dash'), view('mon', 'panel')])
    expect(listThirdPartyViews().map((v) => v.fullName)).toEqual(['mon:dash', 'mon:panel'])
    for (const [uri, id] of [
      ['localix://ui/plugin/view/mon%3Adash', 'plugin-view:mon:dash'],
      ['localix://ui/plugin/view/mon%3Apanel', 'plugin-view:mon:panel'],
    ] as const) {
      const location = resolveUiLocation(uri)
      expect(location?.descriptor).toMatchObject({ effect: 'read', surface: 'plugin' })
      expect(location?.target).toMatchObject({ kind: 'work-item', workKind: 'plugin-view', id })
    }
  })

  test('REMOVES views for a plugin that drops out of a later sync', () => {
    syncThirdPartyViews([view('a', 'v'), view('b', 'w')])
    expect(listThirdPartyViews()).toHaveLength(2)
    // b disabled/uninstalled → only a remains.
    syncThirdPartyViews([view('a', 'v')])
    expect(listThirdPartyViews().map((v) => v.fullName)).toEqual(['a:v'])
    // everything disabled → empty.
    syncThirdPartyViews([])
    expect(listThirdPartyViews()).toEqual([])
    expect(resolveUiLocation('localix://ui/plugin/view/a%3Av')).toBeNull()
  })

  test('bumps the version + notifies subscribers only on a real change', () => {
    let hits = 0
    const unsub = subscribeThirdPartyViews(() => hits++)
    const v0 = thirdPartyViewsVersion()
    syncThirdPartyViews([view('a', 'v')])
    expect(hits).toBe(1)
    expect(thirdPartyViewsVersion()).toBeGreaterThan(v0)
    // Idempotent re-sync with the same set → no notify, no version bump.
    const v1 = thirdPartyViewsVersion()
    syncThirdPartyViews([view('a', 'v')])
    expect(hits).toBe(1)
    expect(thirdPartyViewsVersion()).toBe(v1)
    unsub()
  })

  test('publishes metadata changes when a view keeps the same identity', () => {
    let hits = 0
    const unsub = subscribeThirdPartyViews(() => hits++)
    syncThirdPartyViews([{ ...view('a', 'v'), title: 'Old title', icon: 'Box' }])
    const v1 = thirdPartyViewsVersion()

    syncThirdPartyViews([{ ...view('a', 'v'), title: 'New title', icon: 'ChartLine' }])

    expect(hits).toBe(2)
    expect(thirdPartyViewsVersion()).toBeGreaterThan(v1)
    expect(listThirdPartyViews()).toEqual([
      { ...view('a', 'v'), title: 'New title', icon: 'ChartLine' },
    ])
    unsub()
  })

  test('requires explicit manifest copy before publishing a third-party view to the agent', () => {
    setEnabledPluginNames(new Set(['mon']))
    syncThirdPartyViews([view('mon', 'dash')])
    expect(
      listUiLocations({ exposure: 'agent' }).some(
        (location) => location.uri === 'localix://ui/plugin/view/mon%3Adash',
      ),
    ).toBe(false)

    syncThirdPartyViews([
      {
        ...view('mon', 'dash'),
        agentDescription: 'Open monitoring metrics when a dashboard would help.',
      },
    ])
    expect(
      listUiLocations({ exposure: 'agent' }).find(
        (location) => location.uri === 'localix://ui/plugin/view/mon%3Adash',
      )?.agent?.description,
    ).toBe('Open monitoring metrics when a dashboard would help.')
  })
})
