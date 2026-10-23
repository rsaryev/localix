import { afterAll, expect, test } from 'bun:test'
import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'

import { contentTypeForPath } from '@/shared/lib/contentTypeRouting'
import { fileEditorEnhancersFor } from './fileEditorEnhancers'
import { fileEditorById } from './fileEditors'
import { fileTreeDecorationProviderId } from './fileTreeDecorations'
import { miniAppUiHostFor, removeMiniAppUiContributions } from './host'
import { contributedVscFileIcon, resourceRefIcon } from './iconContributions'
import { setEnabledMiniAppNames } from './miniAppActivation'
import { searchDomains } from './searchDomains'
import { sessionEventHandlersFor } from './sessionEvents'
import { sessionSurfacesFor } from './sessionSurfaces'
import { statusItemsFor } from './statusItems'
import { toolCardFor } from './toolCards'
import { commentActions } from './commentActions'
import { contributedActions } from './actions'
import { resolveUiAnchor } from './uiAnchors'
import { railSectionRegistry, railViewletRegistry, workItemKindRegistry } from './uiContrib'
import { isRegisteredUiLocationUri } from './uiLocations'
import { workItemSlot } from './workItemSlots'

const OWNER = 'removal-fixture'
const None = () => null
// The shape the host derives for a viewlet destination (`host.ts`), under an id of its own.
const LOCATION_URI = `localix://ui/work-item/viewlet/${encodeURIComponent('removal-fixture:loc')}`

type Seam = keyof MiniAppUiHost
/**
 * One registration and one "is it there?" per seam of the plugin façade. The completeness check
 * below compares these keys with the façade itself, so a seam added to `miniAppUiHostFor` without
 * a removal in `removeMiniAppUiContributions` fails here instead of leaking on the next reload.
 */
const SEAMS: Record<Seam, { register: (host: MiniAppUiHost) => void; present: () => boolean }> = {
  workItems: {
    register: (host) =>
      host.workItems.register({
        kind: `${OWNER}:kind`,
        Component: None,
        Icon: None,
        restorable: true,
      }),
    present: () => workItemKindRegistry.getRegistered(`${OWNER}:kind`) !== undefined,
  },
  railSections: {
    register: (host) =>
      host.railSections.register({ id: `${OWNER}:section`, title: 'S', Icon: None, Sidebar: None }),
    present: () => railSectionRegistry.getRegistered(`${OWNER}:section`) !== undefined,
  },
  railViewlets: {
    register: (host) =>
      host.railViewlets.register({
        kind: `${OWNER}:viewlet`,
        title: 'V',
        label: 'V',
        Icon: None,
        defaultArea: 'bar',
      }),
    present: () => railViewletRegistry.getRegistered(`${OWNER}:viewlet`) !== undefined,
  },
  search: {
    register: (host) => host.search.register({ id: `${OWNER}:search`, icons: {} }),
    present: () => searchDomains().some((domain) => domain.id === `${OWNER}:search`),
  },
  anchors: {
    register: (host) =>
      host.anchors.register({
        id: `${OWNER}:anchor`,
        namespaces: [OWNER],
        resolve: () => ({ kind: 'work-item', workKind: `${OWNER}:kind`, id: 'x', title: 'X' }),
      }),
    present: () => resolveUiAnchor(`localix://resource/${OWNER}/x`) !== null,
  },
  locations: {
    register: (host) =>
      host.locations.register({
        id: `${OWNER}:location`,
        uri: LOCATION_URI,
        title: 'L',
        description: 'Open L',
        agent: { description: 'Open L' },
        keywords: [],
        group: 'View',
        effect: 'read',
        surface: 'work-item',
        exposure: { search: true },
        resolve: () => ({ kind: 'work-item', workKind: `${OWNER}:loc`, id: 'loc', title: 'L' }),
      }),
    present: () => isRegisteredUiLocationUri(LOCATION_URI),
  },
  resourceRefIcons: {
    register: (host) => host.resourceRefIcons.register({ [`${OWNER}-icon`]: None }),
    present: () => resourceRefIcon(`${OWNER}-icon`) !== undefined,
  },
  fileIcons: {
    register: (host) => host.fileIcons.register(`${OWNER}.cfg`, { svg: '<svg/>' } as never),
    present: () => contributedVscFileIcon(`${OWNER}.cfg`) !== undefined,
  },
  fileEditors: {
    register: (host) =>
      host.fileEditors.register({
        id: `${OWNER}:editor`,
        label: 'E',
        match: () => false,
        Component: None,
      }),
    present: () => fileEditorById(`${OWNER}:editor`) !== undefined,
  },
  fileFormats: {
    register: (host) =>
      host.fileFormats.register({
        removalfixture: { contentType: 'x/removal', viewer: 'pdf' } as never,
      }),
    present: () => contentTypeForPath('a.removalfixture') === 'x/removal',
  },
  sessionEvents: {
    register: (host) => host.sessionEvents.register(`${OWNER}:event`, () => {}),
    present: () => sessionEventHandlersFor(`${OWNER}:event`).length > 0,
  },
  workItemSlots: {
    register: (host) => host.workItemSlots.register({ slot: `${OWNER}.slot`, Component: None }),
    present: () => workItemSlot(`${OWNER}.slot`) !== undefined,
  },
  sessionSurfaces: {
    register: (host) =>
      host.sessionSurfaces.register({ surface: `${OWNER}.surface`, Component: None }),
    present: () => sessionSurfacesFor(`${OWNER}.surface`).length > 0,
  },
  fileEditorEnhancers: {
    register: (host) =>
      host.fileEditorEnhancers.register({
        id: `${OWNER}:enhancer`,
        match: () => true,
        Component: None,
      }),
    present: () =>
      fileEditorEnhancersFor('any.txt').some((item) => item.id === `${OWNER}:enhancer`),
  },
  fileTreeDecorations: {
    register: (host) =>
      host.fileTreeDecorations.register({
        id: `${OWNER}:decoration`,
        useIndex: () => ({ decorationFor: () => undefined, directoryHasDecorations: () => false }),
      }),
    present: () => fileTreeDecorationProviderId() === `${OWNER}:decoration`,
  },
  statusItems: {
    register: (host) =>
      host.statusItems.register({
        id: `${OWNER}:status`,
        placement: 'statusbar',
        useState: () => null,
      } as never),
    present: () => statusItemsFor('statusbar').some((item) => item.id === `${OWNER}:status`),
  },
  toolCards: {
    register: (host) =>
      host.toolCards.register({
        tool: `${OWNER}_tool`,
        presentation: { label: 'T', noun: 'calls', verb: 'Running', Icon: None, stackable: false },
      }),
    present: () => toolCardFor(`${OWNER}_tool`) !== undefined,
  },
  commentActions: {
    register: (host) =>
      host.commentActions.register({
        id: `${OWNER}:comment-action`,
        label: 'A',
        Icon: None,
        run: async () => {},
      }),
    present: () => commentActions().some((action) => action.id === `${OWNER}:comment-action`),
  },
  actions: {
    register: (host) =>
      host.actions!.register({
        id: `${OWNER}:picture`,
        label: 'Save',
        Icon: None,
        when: () => true,
        run: async () => {},
      }),
    present: () => contributedActions().some((action) => action.id === `${OWNER}:picture`),
  },
}

afterAll(() => {
  removeMiniAppUiContributions(OWNER)
  setEnabledMiniAppNames(null)
})

test('every seam a plugin can register through is one the host can take back', () => {
  const host = miniAppUiHostFor(OWNER)
  expect(Object.keys(SEAMS).sort()).toEqual(Object.keys(host).sort())
  setEnabledMiniAppNames(new Set([OWNER]))

  for (const seam of Object.values(SEAMS)) seam.register(host)
  const registered = Object.entries(SEAMS)
    .filter(([, seam]) => !seam.present())
    .map(([name]) => name)
  expect(registered).toEqual([])

  removeMiniAppUiContributions(OWNER)
  const leaked = Object.entries(SEAMS)
    .filter(([, seam]) => seam.present())
    .map(([name]) => name)
  expect(leaked).toEqual([])

  // Taken back, the same identities are free again: a reload re-registers without collisions.
  for (const seam of Object.values(SEAMS)) seam.register(miniAppUiHostFor(OWNER))
  expect(
    Object.entries(SEAMS)
      .filter(([, seam]) => !seam.present())
      .map(([name]) => name),
  ).toEqual([])
})
