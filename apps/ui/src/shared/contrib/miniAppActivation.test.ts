import { afterEach, describe, expect, it } from 'bun:test'

import { miniAppUiHostFor } from './host'
import { fileEditorById } from './fileEditors'
import { contributedVscFileIcon, resourceRefIcon } from './iconContributions'
import { searchDomains } from './searchDomains'
import { sessionEventHandlersFor } from './sessionEvents'
import { resolveUiAnchor } from './uiAnchors'
import { resolveUiLocation } from './uiLocations'
import { railSectionRegistry, railViewletRegistry, workItemKindRegistry } from './uiContrib'
import {
  miniAppActivationVersion,
  miniAppContributionActivation,
  setEnabledMiniAppNames,
  subscribeMiniAppActivation,
} from './miniAppActivation'

const Component = () => null
const Icon = () => null

afterEach(() => setEnabledMiniAppNames(null))

describe('bundled plugin UI activation', () => {
  it('notifies rail consumers on each authoritative activation publish', () => {
    const versions: number[] = []
    const stop = subscribeMiniAppActivation(() => versions.push(miniAppActivationVersion()))
    try {
      const before = miniAppActivationVersion()
      setEnabledMiniAppNames(new Set(['activation-fixture']))
      setEnabledMiniAppNames(new Set(['activation-fixture']))
      expect(versions).toEqual([before + 1, before + 2])
    } finally {
      stop()
    }
  })

  it('gates every contribution kind by the host-stamped plugin owner', () => {
    const host = miniAppUiHostFor('activation-fixture')
    const handler = () => undefined
    host.workItems.register({ kind: 'activation-fixture:item', Component, Icon })
    host.railSections.register({
      id: 'activation-fixture:section',
      title: 'Fixture',
      Icon,
      Sidebar: Component,
    })
    host.railViewlets.register({
      kind: 'activation-fixture:viewlet',
      title: 'Fixture',
      label: 'Fixture',
      Icon,
      defaultArea: 'overflow',
    })
    host.search.register({ id: 'activation-fixture:search' })
    host.anchors.register({
      id: 'activation-fixture:anchor',
      namespaces: ['fixture'],
      icons: { fixture: Icon },
      resolve: () => ({
        kind: 'work-item',
        workKind: 'activation-fixture:item',
        id: 'activation-fixture:item:x',
        title: 'X',
      }),
    })
    host.fileEditors.register({
      id: 'activation-fixture:editor',
      label: 'Fixture',
      match: () => true,
      Component,
    })
    host.fileIcons.register('activation-fixture.file', { body: '<path/>' })
    host.sessionEvents.register('activation-fixture:updated', handler)

    setEnabledMiniAppNames(null)
    expect(miniAppContributionActivation('activation-fixture')).toBe('pending')
    expect(workItemKindRegistry.get('activation-fixture:item')).toBeUndefined()
    expect(workItemKindRegistry.getRegistered('activation-fixture:item')?.pluginName).toBe(
      'activation-fixture',
    )
    expect(railSectionRegistry.get('activation-fixture:section')).toBeUndefined()
    expect(railViewletRegistry.get('activation-fixture:viewlet')).toBeUndefined()
    expect(searchDomains().some((entry) => entry.id === 'activation-fixture:search')).toBe(false)
    expect(resolveUiAnchor('localix://resource/fixture/item')).toBeNull()
    expect(fileEditorById('activation-fixture:editor')).toBeUndefined()
    expect(contributedVscFileIcon('activation-fixture.file')).toBeUndefined()
    expect(resourceRefIcon('fixture')).toBeUndefined()
    expect(sessionEventHandlersFor('activation-fixture:updated')).toEqual([])

    setEnabledMiniAppNames(new Set(['activation-fixture']))
    expect(miniAppContributionActivation('activation-fixture')).toBe('enabled')
    expect(workItemKindRegistry.get('activation-fixture:item')?.pluginName).toBe(
      'activation-fixture',
    )
    expect(railSectionRegistry.get('activation-fixture:section')?.pluginName).toBe(
      'activation-fixture',
    )
    expect(railViewletRegistry.get('activation-fixture:viewlet')?.pluginName).toBe(
      'activation-fixture',
    )
    expect(searchDomains().some((entry) => entry.id === 'activation-fixture:search')).toBe(true)
    expect(resolveUiAnchor('localix://resource/fixture/item')).toMatchObject({
      workKind: 'activation-fixture:item',
    })
    expect(
      resolveUiLocation('localix://ui/sidebar/section/activation-fixture%3Asection')?.descriptor,
    ).toMatchObject({
      effect: 'read',
      surface: 'sidebar',
    })
    expect(
      resolveUiLocation('localix://ui/work-item/viewlet/activation-fixture%3Aviewlet')?.descriptor,
    ).toMatchObject({
      effect: 'read',
      surface: 'work-item',
    })
    expect(fileEditorById('activation-fixture:editor')?.pluginName).toBe('activation-fixture')
    expect(contributedVscFileIcon('activation-fixture.file')?.body).toBe('<path/>')
    expect(resourceRefIcon('fixture')).toBe(Icon)
    expect(sessionEventHandlersFor('activation-fixture:updated')).toEqual([handler])

    setEnabledMiniAppNames(new Set(['someone-else']))
    expect(miniAppContributionActivation('activation-fixture')).toBe('disabled')
    expect(workItemKindRegistry.get('activation-fixture:item')).toBeUndefined()
    expect(contributedVscFileIcon('activation-fixture.file')).toBeUndefined()
    expect(resolveUiAnchor('localix://resource/fixture/item')).toBeNull()
    expect(
      resolveUiLocation('localix://ui/sidebar/section/activation-fixture%3Asection'),
    ).toBeNull()
    expect(
      resolveUiLocation('localix://ui/work-item/viewlet/activation-fixture%3Aviewlet'),
    ).toBeNull()
    expect(sessionEventHandlersFor('activation-fixture:updated')).toEqual([])
  })
})
