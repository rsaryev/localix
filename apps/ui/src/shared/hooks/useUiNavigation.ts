import { useMemo } from 'react'
import { useRoutedNavigation } from './useRoutedNavigation'
import { inspector, type OpenWorkItemRequest } from '@/shared/lib/inspectorBus'
import { navigateSettings } from '@/shared/lib/settingsNavBus'
import type { UiNavigationHost, UiNavigationTarget } from '@/shared/lib/uiNavigation'
import { openSidebarSection } from '@/shared/lib/sidebarSectionBus'
import { runUiCommand } from '@/shared/contrib/uiCommands'
import { openModelPicker } from '@/shared/lib/modelPickerBus'
import { openUiOverlay } from '@/shared/lib/uiOverlayBus'

export interface UiNavigationOptions {
  /**
   * The chat this navigation acts for — the session of the transcript or tab it was created in
   * (`useWorkItemSessionId()`), or the open chat for a page-level surface. Required, and `null`
   * only where no chat exists (an app-level surface such as Settings).
   *
   * A bare resource anchor or file link names no session, and used to
   * open in whichever chat was active when the navigation ran — so a link clicked in a background
   * chat's transcript opened its file or board in another chat. The caller knows whose content it
   * is; an anchor's own session still wins over it.
   */
  sessionId: string | null
  sessionProjectId?: (sessionId: string) => string | null
}

/**
 * The tab a `work-item` target opens: in the session the anchor names, else in the session the
 * navigation was created for. With neither, the scope is `null` — the grid opens an app-level kind
 * there and refuses a session kind (`resolveOpenScope`), so nothing guesses a chat for it.
 */
export function workItemRequestOf(
  target: Extract<UiNavigationTarget, { kind: 'work-item' }>,
  sessionId: string | null,
): OpenWorkItemRequest {
  const { kind: _kind, session, ...item } = target
  return { ...item, scope: session ?? sessionId }
}

function openInspectorTarget(
  target: Extract<UiNavigationTarget, { kind: 'inspector' }>,
  sessionId: string | null,
): void {
  if (target.target === 'global-search') {
    // A chat's Search tab — none opens for a navigation that belongs to no chat.
    if (sessionId) inspector.openGlobalSearch(sessionId, target.query, target.searchScope)
  } else if (target.target === 'stats') inspector.openStats()
  else if (target.target === 'terminal') {
    // `command`/`title` are forwarded, not dropped. The anchor contract declares a terminal
    // PROFILE — "open a pane running X" — and the bus has always accepted one; this adapter read
    // only `mode`, so every profile ever resolved through here opened a plain shell instead, and
    // did it silently.
    const terminalSession = target.sessionId ?? sessionId
    if (!terminalSession) return
    inspector.openTerminal(terminalSession, {
      mode: target.terminalMode,
      command: target.command,
      title: target.title,
    })
  } else if (target.target === 'message-replay') {
    inspector.openMessageReplay(target.sessionId, target.messageId)
  } else inspector.openStats()
}

/** Concrete host adapter shared by every URI-navigation consumer. */
export function useUiNavigation(options: UiNavigationOptions): UiNavigationHost {
  const nav = useRoutedNavigation()
  const goToSession = nav.goToSession
  const switchProject = nav.switchProject
  const { sessionId, sessionProjectId } = options

  return useMemo<UiNavigationHost>(
    () => ({
      open: (target, access) => {
        switch (target.kind) {
          case 'session':
          case 'message':
            {
              const project = sessionProjectId?.(target.sessionId)
              goToSession(target.sessionId, project ? { project } : undefined)
            }
            break
          case 'project':
            switchProject(target.projectId)
            break
          case 'settings':
            inspector.openSettings()
            navigateSettings(target.tab, target.anchor, target.scope, target.entryId)
            break
          case 'command':
            runUiCommand(target.commandId, access?.allowWrite === true, target.params)
            break
          case 'model-picker':
            openModelPicker({
              sessionId: target.sessionId,
              query: target.query,
              providerId: target.providerId,
            })
            break
          case 'overlay':
            openUiOverlay(target.overlayId, target.params)
            break
          case 'file':
            // A file anchor names no chat; it opens in the one this navigation acts for, or not
            // at all. The anchor's columns are 1-indexed (what an agent reads off a location);
            // the editor's open options are 0-based characters.
            if (!sessionId) break
            inspector.openFile({
              sessionId,
              path: target.path,
              line: target.line,
              ...(target.column ? { column: target.column - 1 } : {}),
              ...(target.endLine ? { endLine: target.endLine } : {}),
              ...(target.endColumn ? { endColumn: target.endColumn - 1 } : {}),
            })
            break
          case 'rail-section':
            openSidebarSection(target.sectionId)
            break
          case 'inspector':
            openInspectorTarget(target, sessionId)
            break
          case 'work-item':
            inspector.openWorkItem(workItemRequestOf(target, sessionId))
            break
          case 'work-item-focus':
            inspector.focusWorkItem(target.id)
            break
        }
      },
    }),
    [goToSession, sessionId, sessionProjectId, switchProject],
  )
}
