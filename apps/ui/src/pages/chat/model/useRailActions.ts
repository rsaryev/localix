import { createElement, useMemo, useSyncExternalStore, type ComponentType } from 'react'
import { Zap, ZapOff, Settings, RotateCcw, BarChart3, Search } from 'lucide-react'
import {
  useGridStore,
  closeGridTab,
  focusedVisibleTabId,
  type WorkItemKind,
} from '@/entities/workspace-grid/model'
import { inspector } from '@/shared/lib/inspectorBus'
import { requireOpenChat } from '@/shared/lib/pageOpenChat'
import { openPageWorkItem } from './openPageWorkItem'
import { pluginViewRailAction } from './pluginViewRailAction'
import { requestConfirmation } from '@/shared/lib/confirmAction'
import { railViewletRegistry } from '@/shared/contrib/uiContrib'
import {
  pluginActivationVersion,
  subscribePluginActivation,
} from '@/shared/contrib/pluginActivation'
import { CMD } from '@/shared/lib/keybindings'
import type { PluginViewSpec } from '@/shared/api/contracts'
import type { RailAction, RailArea } from '@/widgets/workspace-shell'
import type { useSystemToggle } from '@/shared/hooks/useSystemToggle'
import { isPluginRailViewlet } from './railViewletProvenance'
import { capabilityResourceUri } from '@localixai/plugin-sdk/navigation'
import type { PluginCategory } from '@localixai/plugin-sdk/manifest'

interface ViewletDef {
  toolCategory?: PluginCategory
  kind: WorkItemKind
  icon: ComponentType<{ className?: string }>
  label: string
  open: () => void
  defaultArea: RailArea
  /** Keybinding id whose live chord annotates the rail tooltip (opt-in). */
  chordId?: string
  /** Contributed by a bundled plugin's `ui/register.tsx`; grouped by manifest category. */
  plugin?: boolean
  pluginName?: string
  resourceUri?: string
}

// Built-in viewlets — CUSTOMIZABLE rail entries. With the inspector docks gone,
// the rail is their entry point — clicking opens (or, when one of that KIND is the
// focused tab, closes) the panel. Opens go through the inspector bus so the panel
// lands in the right-side editor group (like files / agent reveals), never in the
// focused chat group. Active/close is matched by `kind` (not a fixed id) so it
// works uniformly for the singletons AND for terminals (one tab per backend PTY).
// `defaultArea` seeds where each lands before the user customizes the rail.
//
// Subsystem-contributed viewlets are MERGED in at
// hook-call time from the open `railViewletRegistry` — core names no such
// subsystem; each opens its tab — in the chat the page has open, unless its kind
// is app-level — through the generic `inspector.openWorkItem` grid path.
const coreViewlets = (openSessionId: string | null): ViewletDef[] => [
  {
    kind: 'global-search',
    icon: Search,
    label: 'Search — everything across the workspace',
    // Search is one tab per chat: the open chat's, or a notice that none is open.
    open: () => {
      const sessionId = requireOpenChat(openSessionId)
      if (sessionId) inspector.openGlobalSearch(sessionId)
    },
    defaultArea: 'top',
    chordId: CMD.globalSearch,
  },
  // Terminal + Source Control live in the titlebar's quick-access cluster
  // (BreadcrumbTrailingActions), their single home — so the rail doesn't duplicate
  // them. Everything below is a customizable rail viewlet.
  {
    kind: 'stats',
    icon: BarChart3,
    label: 'Usage & Spend',
    toolCategory: 'utilities',
    open: () => inspector.openStats(),
    defaultArea: 'bottom',
  },
]

interface UseRailActionsArgs {
  /** The chat the page has open — where a session view a rail button opens belongs. */
  openSessionId: string | null
  /** Third-party plugin VIEWS — one rail button each, each opening its bridged
   *  iframe as an editor-grid tab of the open chat. */
  pluginViews: PluginViewSpec[]
  capabilityScope: string
  /** Host "keep awake" toggle state (rail button in the bottom group). */
  keepAwake: ReturnType<typeof useSystemToggle>
  isMobile: boolean
  setSidebarOpen: (open: boolean) => void
  setConfirmKeepAwake: (open: boolean) => void
}

/**
 * Builds the LEFT-rail action buttons for the workspace shell, now driving the
 * editor grid directly (plugin views + Settings open as grid WorkItems).
 *
 * The built-in section viewlets (Office / Source Control / Terminal / Usage)
 * don't get a rail button each — they open as grid tabs from
 * their own surfaces. What remains here is what nothing else surfaces: plugin
 * views (content-driven), the host keep-awake toggle, reset-layout, and
 * Settings as a familiar always-there entry point.
 */
export function useRailActions({
  openSessionId,
  pluginViews,
  capabilityScope,
  keepAwake,
  isMobile,
  setSidebarOpen,
  setConfirmKeepAwake,
}: UseRailActionsArgs): RailAction[] {
  'use no memo'
  // React Compiler otherwise retains the assembled action array from before async plugin
  // registration, even after the activation revision and contributed viewlets change.
  const resetLayout = useGridStore((s) => s.resetLayout)
  // The id + kind of the FOCUSED group's VISIBLE active tab (scope-correct — not the
  // raw activeTab, which can be a hidden background-session tab) — drives the dots.
  const focusedActiveId = useGridStore(focusedVisibleTabId)
  const focusedActiveKind = useGridStore((s) => {
    const id = focusedVisibleTabId(s)
    return id ? (s.items[id]?.kind ?? null) : null
  })
  const settingsTabActive = focusedActiveKind === 'settings'

  // Core viewlets + every subsystem-contributed rail viewlet. The
  // registry is populated by generic contrib discovery (see `discoverUi`) before
  // this hook first runs; a contributed viewlet opens its global singleton tab via
  // the generic `openWorkItem` grid path, so core needs no per-viewlet bus method.
  // The registry is a mutable singleton, not React state. Without this explicit
  // activation dependency, React Compiler can retain the empty cold-start list
  // until an unrelated interaction.
  const activationVersion = useSyncExternalStore(subscribePluginActivation, pluginActivationVersion)
  const contributedViewlets = useMemo(
    () =>
      railViewletRegistry.list().map((v) => ({
        kind: v.kind as WorkItemKind,
        icon: v.Icon,
        label: v.label,
        defaultArea: v.defaultArea,
        chordId: v.chordId,
        // Core feature contribs use the same open registry as bundled plugins.
        // Ownership is stamped only by pluginUiHostFor(), so provenance—not the
        // fact that an entry was contributed—decides which overflow group owns it.
        plugin: isPluginRailViewlet(v),
        toolCategory: v.toolCategory,
        pluginName: v.pluginName,
        resourceUri: v.pluginName
          ? capabilityResourceUri({
              kind: 'view',
              id: v.kind,
              scope: capabilityScope,
              label: v.label,
              description: `View contributed by ${v.pluginName}`,
              enabled: true,
            })
          : undefined,
        open: () =>
          openPageWorkItem(openSessionId, { workKind: v.kind, id: v.kind, title: v.title }),
      })),
    [activationVersion, capabilityScope, openSessionId],
  )
  const viewlets: ViewletDef[] = [...coreViewlets(openSessionId), ...contributedViewlets]

  const runWorkspaceViewAction = (action: () => void) => {
    // A workspace view renders in the editor grid, not in the mobile drawer. Close the drawer in
    // the same gesture so the newly opened tab is immediately visible; sidebar sections (Files,
    // Markets, …) still use WorkspaceShell's separate section callback and intentionally stay open.
    if (isMobile) setSidebarOpen(false)
    action()
  }

  return [
    ...viewlets.map(
      ({
        kind,
        icon,
        label,
        open,
        defaultArea,
        chordId,
        plugin,
        toolCategory,
        pluginName,
        resourceUri,
      }) => {
        // Active when a tab of this kind is the focused tab; clicking it then closes
        // that focused tab, else opens/reveals one. Matching by kind (not a fixed
        // id) works the same for singletons and for multi-instance terminals.
        const isActive = focusedActiveKind === kind
        return {
          id: `viewlet:${kind}`,
          icon: createElement(icon, { className: 'size-4.5' }),
          label,
          chordId,
          active: isActive,
          customizable: true,
          defaultArea,
          plugin,
          toolCategory,
          pluginName,
          resourceUri,
          onClick: () =>
            runWorkspaceViewAction(() =>
              isActive && focusedActiveId ? closeGridTab(focusedActiveId) : open(),
            ),
        }
      },
    ),
    ...pluginViews.map((view) =>
      pluginViewRailAction({
        view,
        focusedActiveId,
        openSessionId,
        capabilityScope,
        run: runWorkspaceViewAction,
      }),
    ),
    // Bottom group: host/config controls, set apart from the live-work views.
    {
      id: 'reset-layout',
      icon: createElement(RotateCcw, { className: 'size-4.5' }),
      label: 'Reset layout — editor groups, splits, sidebar & rail icons to defaults',
      active: false,
      customizable: true,
      defaultArea: 'status' as const,
      // Asked, not done. `resetLayout` restores `emptyEditorState`, so this does not just
      // rearrange the workspace — it CLOSES every open tab and empties the reopen-closed history
      // too, with nothing undoable behind it. And it sits in the status strip among ordinary
      // toggles, which is exactly where a misclick comes from.
      onClick: () =>
        requestConfirmation({
          kind: 'reset-layout',
          title: 'Reset the workspace layout?',
          detail:
            'Closes every open tab and puts editor groups, splits, the sidebar width and your rail icons back to defaults. This cannot be undone.',
          confirmLabel: 'Reset layout',
          variant: 'destructive',
          perform: () => {
            resetLayout()
            // Sidebar width lives in the shell's own hook — nudge it via a window event.
            window.dispatchEvent(new Event('localix:reset-layout'))
          },
        }),
    },
    ...(keepAwake.state?.available
      ? [
          {
            id: 'keep-awake',
            icon: keepAwake.state.enabled
              ? createElement(Zap, { className: 'size-4.5' })
              : createElement(ZapOff, { className: 'size-4.5' }),
            label: keepAwake.state.enabled
              ? 'Keep awake: on — this machine won’t sleep'
              : 'Keep awake: off — let this machine sleep',
            active: keepAwake.state.enabled,
            customizable: true,
            defaultArea: 'status' as const,
            onClick: () => setConfirmKeepAwake(true),
          },
        ]
      : []),
    {
      id: 'settings',
      icon: createElement(Settings, { className: 'size-4.5' }),
      label: 'Settings',
      active: settingsTabActive,
      customizable: true,
      defaultArea: 'bottom' as const,
      onClick: () => {
        // Route through the inspector bus (like Usage & Spend) so Settings
        // lands in the editor ROLE group, not whatever chat group is focused.
        runWorkspaceViewAction(() => {
          if (settingsTabActive) closeGridTab('settings')
          else inspector.openSettings()
        })
      },
    },
  ]
}
