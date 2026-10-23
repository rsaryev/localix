import type {
  PluginUiHost,
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
  contribution: { pluginName?: string },
  surface: string,
  identity: string,
): string {
  if (!contribution.pluginName) return `${surface}.${identity}`
  const namespace = `${contribution.pluginName}:`
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
    pluginName: contribution.pluginName,
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
    pluginName: contribution.pluginName,
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
 * The singleton {@link PluginUiHost} — the narrow registration façade `discover.ts`
 * hands to every `registerUi(host)`. One adapter over the open registries, so a
 * plugin registers contributions WITHOUT importing host registry modules; a future
 * external UI loader passes the same object to dynamically-loaded plugins.
 */
export const pluginUiHost: PluginUiHost = announcing({
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
  // The same four seams `pluginUiHostFor` exposes — core contributions register through this
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

function assertPluginOwnedIdentity(pluginName: string, surface: string, identity: string): void {
  const namespace = `${pluginName}:`
  if (identity.startsWith(namespace)) return
  throw new Error(
    `[plugin-ui] ${surface} identity "${identity}" must be namespaced by owner "${namespace}"`,
  )
}

/**
 * Host façade for one statically discovered bundled plugin. Ownership is stamped by
 * discovery, never trusted from plugin code, and drives live enable/disable gating.
 */
export function pluginUiHostFor(pluginName: string): PluginUiHost {
  return announcing({
    workItems: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'work-item kind', contribution.kind)
        workItemKindRegistry.register({ ...contribution, pluginName })
      },
    },
    railSections: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'rail section', contribution.id)
        registerRailSection({ ...contribution, pluginName })
      },
    },
    railViewlets: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'rail viewlet', contribution.kind)
        registerRailViewlet({ ...contribution, pluginName })
      },
    },
    search: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'search domain', contribution.id)
        registerSearchDomain({ ...contribution, pluginName })
      },
    },
    anchors: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'resource anchor', contribution.id)
        const owned = { ...contribution, pluginName }
        const accepted = registerUiAnchor(owned)
        if (accepted && owned.icons) registerResourceRefIcons(owned.icons, pluginName)
        return accepted
      },
    },
    locations: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'UI location', contribution.id)
        return registerUiLocation({ ...contribution, pluginName })
      },
    },
    resourceRefIcons: {
      register: (entries) => registerResourceRefIcons(entries, pluginName),
    },
    fileIcons: {
      register: (name, data) => registerVscFileIcon(name, data, pluginName),
    },
    fileEditors: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'file editor', contribution.id)
        registerFileEditor({ ...contribution, pluginName })
      },
    },
    fileFormats: {
      register: (entries) => registerDedicatedViewerTypes(entries, pluginName),
    },
    sessionEvents: {
      register: (type, handler) => {
        assertPluginOwnedIdentity(pluginName, 'session event', type)
        registerSessionEventHandler(type, handler, pluginName)
      },
    },
    // The four seams below fill named holes in surfaces the HOST composes, rather than
    // contributing a surface of their own. Their registries already existed in this folder and
    // their contribution types already shipped in the SDK — only the façade was missing, so a
    // plugin reaching for `host.workItemSlots` got `undefined.register(…)` and lost its whole
    // registration pass. Git Workspace was written against all four and could never load.
    //
    // A SLOT and a SURFACE are host vocabulary, not plugin identity: the host defines
    // `diff.interactive` and `chat.background`, and an unknown one simply renders nothing. So
    // they are not namespace-asserted — there is nothing to collide over, and an owner-prefixed
    // slot name would address a hole that does not exist. The two that DO carry plugin-chosen ids
    // are asserted like every other registration.
    workItemSlots: {
      register: (contribution) => registerWorkItemSlot({ ...contribution, pluginName }),
    },
    sessionSurfaces: {
      register: (contribution) => registerSessionSurface({ ...contribution, pluginName }),
    },
    fileEditorEnhancers: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'file editor enhancer', contribution.id)
        registerFileEditorEnhancer({ ...contribution, pluginName })
      },
    },
    fileTreeDecorations: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'file tree decoration', contribution.id)
        registerFileTreeDecoration({ ...contribution, pluginName })
      },
    },
    // A status item carries a plugin-chosen id, so it is asserted. Its PLACEMENT is not: that is
    // host vocabulary like a slot or a surface, and an unknown one renders nothing.
    statusItems: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'status item', contribution.id)
        registerStatusItem({ ...contribution, pluginName })
      },
    },
    // A tool card is keyed by the tool's name as the MODEL calls it, which the plugin's backend
    // chose and the agent's vocabulary fixes — it is not a namespaced UI identity, so it is not
    // asserted. A core tool's name never reaches the contributed card: the transcript consults
    // its own table first (`tool-parts/cards/meta.ts`).
    toolCards: {
      register: (contribution) => registerToolCard({ ...contribution, pluginName }),
    },
    commentActions: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'comment action', contribution.id)
        registerCommentAction({ ...contribution, pluginName })
      },
    },
    actions: {
      register: (contribution) => {
        assertPluginOwnedIdentity(pluginName, 'action', contribution.id)
        registerAction({ ...contribution, pluginName })
      },
    },
  })
}

/**
 * Take back everything {@link pluginUiHostFor} let `pluginName` register — the inverse of that
 * façade, kept beside it so a new seam cannot be added without its removal
 * (`pluginUiHost.test.ts` registers through every seam and requires this to empty each one).
 *
 * The registries were add-only, so the ONLY way to replace a plugin's UI was to throw the
 * whole page away: an edit to one plugin reloaded the app, mid-turn, while an agent was writing
 * that plugin. With removal, replacing a plugin is remove + register, and nothing outside the
 * plugin is touched. Every registry already stamps entries with their owner, so this can never
 * reach a core entry.
 */
export function removePluginUiContributions(pluginName: string): void {
  workItemKindRegistry.removeOwner(pluginName)
  railSectionRegistry.removeOwner(pluginName)
  railViewletRegistry.removeOwner(pluginName)
  removeSearchDomainsOf(pluginName)
  removeUiAnchorsOf(pluginName)
  removeUiLocationsOf(pluginName)
  removeIconsOf(pluginName)
  removeFileEditorsOf(pluginName)
  removeDedicatedViewerTypesOf(pluginName)
  removeSessionEventHandlersOf(pluginName)
  removeWorkItemSlotsOf(pluginName)
  removeSessionSurfacesOf(pluginName)
  removeFileEditorEnhancersOf(pluginName)
  removeFileTreeDecorationOf(pluginName)
  removeStatusItemsOf(pluginName)
  removeToolCardsOf(pluginName)
  removeCommentActionsOf(pluginName)
  removeActionsOf(pluginName)
  noteRegistryChange()
}
