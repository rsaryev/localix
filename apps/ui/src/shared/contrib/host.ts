import type {
  MiniAppUiHost,
  RailSectionContribution,
  RailViewletContribution,
} from '@localixai/mini-app-sdk/ui'
import { railSectionRegistry, railViewletRegistry, workItemKindRegistry } from './uiContrib'
import { registerSearchDomain, removeSearchDomainsOf } from './searchDomains'
import { registerResourceRefIcons, registerVscFileIcon, removeIconsOf } from './iconContributions'
import { registerFileEditor, removeFileEditorsOf } from './fileEditors'
import {
  registerDedicatedViewerTypes,
  removeDedicatedViewerTypesOf,
} from '@/shared/lib/contentTypeRouting'
import { registerSessionEventHandler, removeSessionEventHandlersOf } from './sessionEvents'
import { registerUiAnchor, removeUiAnchorsOf } from './uiAnchors'
import { registerUiLocation, removeUiLocationsOf } from './uiLocations'
import { registerWorkItemSlot, removeWorkItemSlotsOf } from './workItemSlots'
import { registerSessionSurface, removeSessionSurfacesOf } from './sessionSurfaces'
import { registerFileEditorEnhancer, removeFileEditorEnhancersOf } from './fileEditorEnhancers'
import { registerFileTreeDecoration, removeFileTreeDecorationOf } from './fileTreeDecorations'
import { registerStatusItem, removeStatusItemsOf } from './statusItems'
import { registerToolCard, removeToolCardsOf } from './toolCards'
import { registerCommentAction, removeCommentActionsOf } from './commentActions'
import { registerAction, removeActionsOf } from './actions'
import { announcing, noteRegistryChange } from './registryChanges'

function derivedLocationId(
  contribution: { miniAppName?: string },
  surface: string,
  identity: string,
): string {
  if (!contribution.miniAppName) return `${surface}.${identity}`
  const namespace = `${contribution.miniAppName}:`
  const localIdentity = identity.startsWith(namespace) ? identity.slice(namespace.length) : identity
  return `${namespace}${surface}:${localIdentity}`
}

function registerRailSection(contribution: RailSectionContribution): void {
  railSectionRegistry.register(contribution)
  if (railSectionRegistry.getRegistered(contribution.id) !== contribution) return
  registerUiLocation({
    id: derivedLocationId(contribution, 'rail-section.open', contribution.id),
    uri: `localix://ui/sidebar/section/${encodeURIComponent(contribution.id)}`,
    title: contribution.paletteLabel ?? contribution.title,
    description: `Open the ${contribution.title} sidebar`,
    agent: { description: `Open the ${contribution.title} sidebar` },
    keywords: contribution.keywords ?? [],
    group: 'View',
    Icon: contribution.Icon,
    miniAppName: contribution.miniAppName,
    effect: 'read',
    surface: 'sidebar',
    exposure: { search: true },
    resolve: () => ({ kind: 'rail-section', sectionId: contribution.id }),
  })
}

function registerRailViewlet(contribution: RailViewletContribution): void {
  railViewletRegistry.register(contribution)
  if (railViewletRegistry.getRegistered(contribution.kind) !== contribution) return
  registerUiLocation({
    id: derivedLocationId(contribution, 'rail-viewlet.open', contribution.kind),
    uri: `localix://ui/work-item/viewlet/${encodeURIComponent(contribution.kind)}`,
    title: contribution.label,
    description: `Open ${contribution.title}`,
    agent: { description: `Open ${contribution.title}` },
    keywords: contribution.keywords ?? [],
    group: 'View',
    Icon: contribution.Icon,
    miniAppName: contribution.miniAppName,
    effect: 'read',
    surface: 'work-item',
    exposure: { search: true },
    resolve: () => ({
      kind: 'work-item',
      workKind: contribution.kind,
      id: contribution.kind,
      title: contribution.title,
    }),
  })
}

/**
 * The singleton {@link MiniAppUiHost} — the narrow registration façade `discover.ts`
 * hands to every `registerUi(host)`. One adapter over the open registries, so a
 * mini app registers contributions WITHOUT importing host registry modules; a future
 * external UI loader passes the same object to dynamically-loaded mini apps.
 */
export const miniAppUiHost: MiniAppUiHost = announcing({
  workItems: { register: (c) => workItemKindRegistry.register(c) },
  railSections: { register: registerRailSection },
  railViewlets: { register: registerRailViewlet },
  search: { register: (c) => registerSearchDomain(c) },
  anchors: {
    register: (c) => {
      const accepted = registerUiAnchor(c)
      if (accepted && c.icons) registerResourceRefIcons(c.icons)
      return accepted
    },
  },
  locations: { register: (contribution) => registerUiLocation(contribution) },
  resourceRefIcons: {
    register: (entries) => registerResourceRefIcons(entries),
  },
  fileIcons: { register: (name, data) => registerVscFileIcon(name, data) },
  fileEditors: { register: (c) => registerFileEditor(c) },
  fileFormats: { register: (entries) => registerDedicatedViewerTypes(entries) },
  // The same four seams `miniAppUiHostFor` exposes — core contributions register through this
  // singleton, so leaving them off here would make the façade narrower than the interface.
  workItemSlots: { register: (c) => registerWorkItemSlot(c) },
  sessionSurfaces: { register: (c) => registerSessionSurface(c) },
  fileEditorEnhancers: { register: (c) => registerFileEditorEnhancer(c) },
  fileTreeDecorations: { register: (c) => registerFileTreeDecoration(c) },
  statusItems: { register: (c) => registerStatusItem(c) },
  toolCards: { register: (c) => registerToolCard(c) },
  commentActions: { register: (c) => registerCommentAction(c) },
  actions: { register: (c) => registerAction(c) },
  sessionEvents: {
    register: (type, handler) => registerSessionEventHandler(type, handler),
  },
})

function assertMiniAppOwnedIdentity(miniAppName: string, surface: string, identity: string): void {
  const namespace = `${miniAppName}:`
  if (identity.startsWith(namespace)) return
  throw new Error(
    `[mini-app-ui] ${surface} identity "${identity}" must be namespaced by owner "${namespace}"`,
  )
}

/**
 * Host façade for one mini app's UI. Ownership is stamped by
 * discovery, never trusted from mini app code, and drives live enable/disable gating.
 */
export function miniAppUiHostFor(miniAppName: string): MiniAppUiHost {
  return announcing({
    workItems: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'work-item kind', contribution.kind)
        workItemKindRegistry.register({ ...contribution, miniAppName })
      },
    },
    railSections: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'rail section', contribution.id)
        registerRailSection({ ...contribution, miniAppName })
      },
    },
    railViewlets: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'rail viewlet', contribution.kind)
        registerRailViewlet({ ...contribution, miniAppName })
      },
    },
    search: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'search domain', contribution.id)
        registerSearchDomain({ ...contribution, miniAppName })
      },
    },
    anchors: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'resource anchor', contribution.id)
        const owned = { ...contribution, miniAppName }
        const accepted = registerUiAnchor(owned)
        if (accepted && owned.icons) registerResourceRefIcons(owned.icons, miniAppName)
        return accepted
      },
    },
    locations: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'UI location', contribution.id)
        return registerUiLocation({ ...contribution, miniAppName })
      },
    },
    resourceRefIcons: {
      register: (entries) => registerResourceRefIcons(entries, miniAppName),
    },
    fileIcons: {
      register: (name, data) => registerVscFileIcon(name, data, miniAppName),
    },
    fileEditors: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'file editor', contribution.id)
        registerFileEditor({ ...contribution, miniAppName })
      },
    },
    fileFormats: {
      register: (entries) => registerDedicatedViewerTypes(entries, miniAppName),
    },
    sessionEvents: {
      register: (type, handler) => {
        assertMiniAppOwnedIdentity(miniAppName, 'session event', type)
        registerSessionEventHandler(type, handler, miniAppName)
      },
    },
    // The four seams below fill named holes in surfaces the HOST composes, rather than
    // contributing a surface of their own. Their registries already existed in this folder and
    // their contribution types already shipped in the SDK — only the façade was missing, so a
    // mini app reaching for `host.workItemSlots` got `undefined.register(…)` and lost its whole
    // registration pass. A mini app was written against all four and could never load.
    //
    // A SLOT and a SURFACE are host vocabulary, not mini app identity: the host defines
    // `diff.interactive` and `chat.background`, and an unknown one simply renders nothing. So
    // they are not namespace-asserted — there is nothing to collide over, and an owner-prefixed
    // slot name would address a hole that does not exist. The two that DO carry mini-app-chosen ids
    // are asserted like every other registration.
    workItemSlots: {
      register: (contribution) => registerWorkItemSlot({ ...contribution, miniAppName }),
    },
    sessionSurfaces: {
      register: (contribution) => registerSessionSurface({ ...contribution, miniAppName }),
    },
    fileEditorEnhancers: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'file editor enhancer', contribution.id)
        registerFileEditorEnhancer({ ...contribution, miniAppName })
      },
    },
    fileTreeDecorations: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'file tree decoration', contribution.id)
        registerFileTreeDecoration({ ...contribution, miniAppName })
      },
    },
    // A status item carries a mini-app-chosen id, so it is asserted. Its PLACEMENT is not: that is
    // host vocabulary like a slot or a surface, and an unknown one renders nothing.
    statusItems: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'status item', contribution.id)
        registerStatusItem({ ...contribution, miniAppName })
      },
    },
    // A tool card is keyed by the tool's name as the MODEL calls it, which the mini app's backend
    // chose and the agent's vocabulary fixes — it is not a namespaced UI identity, so it is not
    // asserted. A core tool's name never reaches the contributed card: the transcript consults
    // its own table first (`tool-parts/cards/meta.ts`).
    toolCards: {
      register: (contribution) => registerToolCard({ ...contribution, miniAppName }),
    },
    commentActions: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'comment action', contribution.id)
        registerCommentAction({ ...contribution, miniAppName })
      },
    },
    actions: {
      register: (contribution) => {
        assertMiniAppOwnedIdentity(miniAppName, 'action', contribution.id)
        registerAction({ ...contribution, miniAppName })
      },
    },
  })
}

/**
 * Take back everything {@link miniAppUiHostFor} let `miniAppName` register — the inverse of that
 * façade, kept beside it so a new seam cannot be added without its removal
 * (`miniAppUiHost.test.ts` registers through every seam and requires this to empty each one).
 *
 * The registries were add-only, so the ONLY way to replace a mini app's UI was to throw the
 * whole page away: an edit to one mini app reloaded the app, mid-turn, while an agent was writing
 * that mini app. With removal, replacing a mini app is remove + register, and nothing outside the
 * mini app is touched. Every registry already stamps entries with their owner, so this can never
 * reach a core entry.
 */
export function removeMiniAppUiContributions(miniAppName: string): void {
  workItemKindRegistry.removeOwner(miniAppName)
  railSectionRegistry.removeOwner(miniAppName)
  railViewletRegistry.removeOwner(miniAppName)
  removeSearchDomainsOf(miniAppName)
  removeUiAnchorsOf(miniAppName)
  removeUiLocationsOf(miniAppName)
  removeIconsOf(miniAppName)
  removeFileEditorsOf(miniAppName)
  removeDedicatedViewerTypesOf(miniAppName)
  removeSessionEventHandlersOf(miniAppName)
  removeWorkItemSlotsOf(miniAppName)
  removeSessionSurfacesOf(miniAppName)
  removeFileEditorEnhancersOf(miniAppName)
  removeFileTreeDecorationOf(miniAppName)
  removeStatusItemsOf(miniAppName)
  removeToolCardsOf(miniAppName)
  removeCommentActionsOf(miniAppName)
  removeActionsOf(miniAppName)
  noteRegistryChange()
}
