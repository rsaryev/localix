import { useEffect } from 'react'
import { registerInspectorHandler } from '@/shared/lib/inspectorBus'
import {
  useGridStore,
  groupOfTab,
  resolveExistingWorkItemFocus,
  leaves,
  activeWorkItemContribution,
} from '@/features/workspace-grid/model'
import { useMessageFocusStore } from '@/shared/lib/messageFocusBus'
import {
  openCommandTerminal,
  openNewTerminal,
  revealOrCreateTerminal,
} from '@/features/terminal/model/terminalTabs'
import { collapseWorkspaceChrome } from '@/shared/lib/workspaceChromeBus'
import { inspectorRequestToEffects, workItemIdMatchesPrefix } from './inspectorBusMapping'

/**
 * Bridges the shared inspector open-request channel onto the editor grid: every
 * `inspector.openFile/openDiff/openTerminal/…` (and agent reveals) opens or closes
 * the matching WorkItem. Registered once as the workspace reveal handler.
 * The grid is always "open", so an
 * agent's explicit reveals always land.
 */
export function useGridInspectorBus(): void {
  useEffect(() => {
    return registerInspectorHandler(
      (req) => {
        // The generic focus location is intentionally weaker than openWorkItem:
        // it may only reveal an exact tab whose payload is already resident and
        // visible in the current scope. This makes payload-bound tabs addressable
        // without accepting HTML, patches, plans, or plugin data through a URI.
        if (req.kind === 'focus-work-item') {
          const st = useGridStore.getState()
          const target = resolveExistingWorkItemFocus(st, req.id)
          const leaf = target ? groupOfTab(st.root, target.id) : null
          if (target && leaf) {
            st.setActiveTab(leaf.id, req.id)
          }
          return
        }
        // Point Activity at the requested message and section before it opens.
        if (req.kind === 'message-replay')
          useMessageFocusStore
            .getState()
            .revealSection(req.sessionId, req.messageId, req.section ?? 'activity')
        // Terminals reveal-or-create through their own (async) helper, in the chat the request
        // names — never the one on screen.
        if (req.kind === 'terminal') {
          const { sessionId } = req
          // A profile always gets its own pane: reusing a shell that is mid-command to start a
          // long-running program would interleave two things in one buffer.
          if (req.command) void openCommandTerminal(sessionId, req.command, req.title ?? 'Terminal')
          else if (req.mode === 'new') void openNewTerminal(sessionId)
          else revealOrCreateTerminal(sessionId)
          return
        }
        // A `solo` file open (localix <file> / file-association) wants a
        // distraction-free view: after placing the tab, maximize its group and
        // collapse the sidebar so ONLY the file is visible.
        const solo = req.kind === 'file' && req.solo === true
        let soloGroup: string | null = null
        for (const eff of inspectorRequestToEffects(req)) {
          if (eff.type === 'close-scope') {
            useGridStore.getState().closeScope(eff.scope)
            continue
          }
          if (eff.type === 'close') {
            const leaf = groupOfTab(useGridStore.getState().root, eff.id)
            if (leaf) useGridStore.getState().closeTab(leaf.id, eff.id)
            continue
          }
          if (eff.type === 'close-prefix') {
            // Close every open tab whose id starts with the prefix (e.g. all of a
            // connection's consoles — its primary + any extra `:<id>` instances).
            const st2 = useGridStore.getState()
            const ids = leaves(st2.root).flatMap((l) =>
              l.tabs.filter((id) =>
                workItemIdMatchesPrefix(id, eff.prefix, {
                  session: eff.session,
                  everyChat: eff.everyChat,
                  itemScope: st2.items[id]?.scope,
                }),
              ),
            )
            for (const id of ids) {
              const leaf = groupOfTab(st2.root, id)
              if (leaf) st2.closeTab(leaf.id, id)
            }
            continue
          }
          // Deterministic placement by the kind's role; if this exact tab is
          // already open, reveal it in place (don't spawn an empty role group).
          const st = useGridStore.getState()
          const already = groupOfTab(st.root, eff.item.id)
          // Number additional tabs that share a "sibling group" so they're distinguishable
          // ("app", "app 2", "app 3") — e.g. a db connection's extra consoles. The kind's
          // contribution declares the group key (subsystem-agnostic); only for a NEW tab.
          if (!already) {
            const groupKey = activeWorkItemContribution(eff.item.kind)?.siblingGroupKey?.(eff.item)
            if (groupKey) {
              const n = leaves(st.root).flatMap((l) =>
                l.tabs.filter((id) => id === groupKey || id.startsWith(`${groupKey}:`)),
              ).length
              if (n > 0) eff.item = { ...eff.item, title: `${eff.item.title} ${n + 1}` }
            }
          }
          const group = already ? already.id : st.resolveRoleGroup(eff.item.kind)
          st.openItem(eff.item, { group, ephemeral: eff.ephemeral, replace: eff.replace })
          if (solo) soloGroup = group
        }
        if (solo && soloGroup) {
          useGridStore.getState().maximizeGroup(soloGroup)
          collapseWorkspaceChrome()
        }
      },
      { isOpen: () => true },
    )
  }, [])
}
