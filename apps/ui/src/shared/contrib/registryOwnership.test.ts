import { expect, spyOn, test } from 'bun:test'

import { fileEditorById, registerFileEditor } from './fileEditors'
import { miniAppUiHostFor } from './host'
import { setEnabledPluginNames } from './miniAppActivation'
import { registerResourceRefIcons, resourceRefIcon } from './iconContributions'
import { registerSearchDomain, searchDomains } from './searchDomains'
import {
  assertMiniAppOwnedWorkItemInstance,
  railSectionRegistry,
  railViewletRegistry,
  workItemKindRegistry,
} from './uiContrib'

const CoreComponent = () => null
const CoreIcon = () => null
const PluginComponent = () => null
const PluginIcon = () => null

test('a plugin cannot submit unowned global UI identities or shadow shared icon keys', () => {
  const pluginName = 'registry-collision-fixture'
  const host = miniAppUiHostFor(pluginName)
  const warn = spyOn(console, 'warn').mockImplementation(() => {})

  try {
    workItemKindRegistry.register({
      kind: 'core-owned-work-item-fixture',
      Component: CoreComponent,
      Icon: CoreIcon,
      restorable: true,
    })
    railSectionRegistry.register({
      id: 'core-owned-section-fixture',
      title: 'Core section',
      Icon: CoreIcon,
      Sidebar: CoreComponent,
    })
    railViewletRegistry.register({
      kind: 'core-owned-viewlet-fixture',
      title: 'Core viewlet',
      label: 'Core viewlet',
      Icon: CoreIcon,
      defaultArea: 'bar',
    })
    registerSearchDomain({ id: 'core-owned-search-fixture', icons: { core: CoreIcon } })
    registerResourceRefIcons({ 'core-owned-icon-fixture': CoreIcon })
    registerFileEditor({
      id: 'core-owned-editor-fixture',
      label: 'Core editor',
      // A narrow matcher, not `() => true`. The file-editor registry is module state
      // shared by the whole `bun test` process, and a catch-all left in it makes every
      // later `fileEditorsFor(...)` return this fixture — `fileEditors.test.ts`'s
      // "non-matching keys return an empty list" got it instead of `[]`.
      match: (path) => path.endsWith('.registry-ownership-fixture'),
      Component: CoreComponent,
    })

    expect(() =>
      host.workItems.register({
        kind: 'core-owned-work-item-fixture',
        Component: PluginComponent,
        Icon: PluginIcon,
      }),
    ).toThrow('must be namespaced by owner "registry-collision-fixture:"')
    expect(() =>
      host.railSections.register({
        id: 'core-owned-section-fixture',
        title: 'Plugin section',
        Icon: PluginIcon,
        Sidebar: PluginComponent,
      }),
    ).toThrow('must be namespaced by owner "registry-collision-fixture:"')
    expect(() =>
      host.railViewlets.register({
        kind: 'core-owned-viewlet-fixture',
        title: 'Plugin viewlet',
        label: 'Plugin viewlet',
        Icon: PluginIcon,
        defaultArea: 'overflow',
      }),
    ).toThrow('must be namespaced by owner "registry-collision-fixture:"')
    expect(() =>
      host.search.register({
        id: 'core-owned-search-fixture',
        icons: { plugin: PluginIcon },
      }),
    ).toThrow('must be namespaced by owner "registry-collision-fixture:"')
    host.resourceRefIcons.register({ 'core-owned-icon-fixture': PluginIcon })
    expect(() =>
      host.fileEditors.register({
        id: 'core-owned-editor-fixture',
        label: 'Plugin editor',
        match: (path) => path.endsWith('.registry-ownership-fixture'),
        Component: PluginComponent,
      }),
    ).toThrow('must be namespaced by owner "registry-collision-fixture:"')
    expect(() => host.anchors.register({ id: 'core-owned-anchor-fixture' } as never)).toThrow(
      'must be namespaced by owner "registry-collision-fixture:"',
    )
    expect(() => host.locations.register({ id: 'core-owned-location-fixture' } as never)).toThrow(
      'must be namespaced by owner "registry-collision-fixture:"',
    )
    expect(() =>
      host.sessionEvents.register('core-owned-session-event-fixture', (() => {}) as never),
    ).toThrow('must be namespaced by owner "registry-collision-fixture:"')

    host.workItems.register({
      kind: 'registry-collision-fixture:owned-kind',
      Component: PluginComponent,
      Icon: PluginIcon,
    })
    expect(() =>
      assertMiniAppOwnedWorkItemInstance({
        workKind: 'registry-collision-fixture:owned-kind',
        id: 'foreign-instance',
        title: 'Foreign',
        scope: 's1',
      }),
    ).toThrow('work-item instance "foreign-instance" must be namespaced')
    expect(() =>
      assertMiniAppOwnedWorkItemInstance({
        workKind: 'registry-collision-fixture:owned-kind',
        id: 'registry-collision-fixture:instance',
        title: 'Owned',
        scope: 's1',
      }),
    ).not.toThrow()

    setEnabledPluginNames(new Set([pluginName]))
    expect(workItemKindRegistry.get('core-owned-work-item-fixture')?.Component).toBe(CoreComponent)
    expect(railSectionRegistry.get('core-owned-section-fixture')?.Sidebar).toBe(CoreComponent)
    expect(railViewletRegistry.get('core-owned-viewlet-fixture')?.Icon).toBe(CoreIcon)
    expect(
      searchDomains().find((entry) => entry.id === 'core-owned-search-fixture')?.icons,
    ).toEqual({
      core: CoreIcon,
    })
    expect(resourceRefIcon('core-owned-icon-fixture')).toBe(CoreIcon)
    expect(fileEditorById('core-owned-editor-fixture')?.Component).toBe(CoreComponent)
    // Resource-icon keys are a shared presentation vocabulary rather than owned
    // contribution identities, so their existing first-wins collision guard remains.
    const shadowed = warn.mock.calls.filter((call) => String(call[0]).includes('-fixture'))
    expect(shadowed).toHaveLength(1)
  } finally {
    setEnabledPluginNames(null)
    warn.mockRestore()
  }
})
