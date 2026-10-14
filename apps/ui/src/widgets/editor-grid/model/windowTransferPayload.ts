import { useChatStore } from '@/features/chat/model/store'
import { findSessionInState } from '@/features/chat/model/findSession'
import {
  GLOBAL_SCOPE,
  isRestorable,
  sessionOfScope,
  type WorkItem,
} from '@/features/workspace-grid/model'
import { fileContentCache } from '@/features/inspector/model/fileContentCache'
import {
  getFileDraft,
  getFileDraftSnapshot,
  setFileDraft,
  type FileDraftSnapshot,
} from '@/features/inspector/model/fileDrafts'
import { usePreviewStore, type PreviewEntry } from '@/features/inspector/model/previewStore'
import { scopePath } from '@/shared/routing/routes'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import {
  terminalOutput,
  retainTerminalOutput,
  resetTerminalOutput,
} from '@/features/terminal/model/terminalOutput'

export type TabWindowDestination = 'window' | 'tab'
export interface TabTransferPayload {
  version: 1
  item: WorkItem
  projectId: string
  sessionId: string | null
  file?: { sessionId: string; path: string; draft: FileDraftSnapshot }
  browser?: { sessionId: string; tabs: PreviewEntry[]; activeId: string | null; pageId?: string }
  terminal?: { id: string; output: string }
}

export function canTransferWorkItem(item: WorkItem | undefined): boolean {
  return (
    !!item && !item.payload?.terminalRestarting && (isRestorable(item.kind) || item.kind === 'diff')
  )
}

/** Snapshot ONE work item; workspace routing is context, never another session or copied layout. */
export function prepareTabTransfer(
  item: WorkItem,
  browserPageId?: string,
): { route: string; payload: TabTransferPayload } {
  if (!canTransferWorkItem(item))
    throw new Error('This tab does not support moving to another window')
  if (browserPageId !== undefined && (item.kind !== 'preview' || !browserPageId))
    throw new Error('Only an open Browser page can move separately')
  const chat = useChatStore.getState()
  const scopeSession = sessionOfScope(item.scope)
  const sessionId =
    item.kind === 'chat' && typeof item.payload?.sessionId === 'string'
      ? item.payload.sessionId
      : (scopeSession ?? chat.activeSessionId)
  const session = sessionId ? findSessionInState(chat, sessionId) : null
  const projectId = session?.projectId ?? chat.activeProjectId
  if (!projectId || (scopeSession && !session)) throw new Error('The tab’s workspace is not ready')
  const payload: TabTransferPayload = {
    version: 1,
    item: { ...item, ephemeral: false },
    projectId,
    sessionId,
  }
  if (item.kind === 'file' && scopeSession && typeof item.payload?.path === 'string') {
    const path = fileContentCache.get(scopeSession, item.payload.path)?.path ?? item.payload.path
    const draft = getFileDraftSnapshot(scopeSession, path)
    if ((item.isDirty || getFileDraft(scopeSession, path) !== undefined) && !draft?.baseHash) {
      throw new Error('The unsaved file is not ready to move; try again after the editor loads')
    }
    if (draft) payload.file = { sessionId: scopeSession, path, draft }
  }
  if (item.kind === 'preview' && scopeSession) {
    const browserSession = workspaceOf(scopeSession)
    const previews = usePreviewStore.getState()
    const tabs = previews.previewTabsBySession[browserSession] ?? []
    const page = browserPageId ? tabs.find((tab) => tab.previewId === browserPageId) : undefined
    if (browserPageId && !page?.url) throw new Error('The Browser page is no longer open')
    payload.browser = {
      sessionId: browserSession,
      tabs: page ? [page] : tabs,
      activeId: page?.previewId ?? previews.previewBySession[browserSession]?.previewId ?? null,
      ...(page ? { pageId: page.previewId } : {}),
    }
  }
  if (item.kind === 'terminal' && item.payload?.terminalExit) {
    const id = item.payload?.terminalId
    const output = typeof id === 'string' ? terminalOutput(id) : undefined
    if (typeof id !== 'string' || output === undefined) {
      throw new Error('This exited terminal has no cached output to move')
    }
    payload.terminal = { id, output }
  }
  const encoded = JSON.stringify(payload)
  if (new TextEncoder().encode(encoded).length > 8 * 1024 * 1024) {
    throw new Error('This tab is too large to move to another window')
  }
  return {
    route: scopePath(projectId, sessionId),
    payload: JSON.parse(encoded) as TabTransferPayload,
  }
}

export function readTabTransferPayload(value: unknown): TabTransferPayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid workspace tab transfer')
  const payload = value as TabTransferPayload
  const item = payload.item
  if (
    payload.version !== 1 ||
    typeof payload.projectId !== 'string' ||
    !payload.projectId ||
    (payload.sessionId !== null && typeof payload.sessionId !== 'string') ||
    !item ||
    typeof item.id !== 'string' ||
    !item.id ||
    typeof item.kind !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.scope !== 'string' ||
    (item.scope !== GLOBAL_SCOPE && !payload.sessionId)
  )
    throw new Error('Invalid workspace tab transfer')
  if (payload.file) {
    const { sessionId, path, draft } = payload.file
    if (
      typeof sessionId !== 'string' ||
      sessionId !== item.scope ||
      typeof path !== 'string' ||
      !draft ||
      typeof draft.content !== 'string' ||
      typeof draft.baseContent !== 'string' ||
      typeof draft.baseHash !== 'string' ||
      !draft.baseHash
    ) {
      throw new Error('Invalid transferred file draft')
    }
  }
  if (
    payload.browser &&
    (payload.browser.sessionId !== workspaceOf(item.scope) ||
      !Array.isArray(payload.browser.tabs) ||
      payload.browser.tabs.some(
        (tab) => !tab || typeof tab.previewId !== 'string' || typeof tab.url !== 'string',
      ))
  )
    throw new Error('Invalid transferred Browser tabs')
  if (
    payload.browser?.pageId &&
    (payload.item.kind !== 'preview' ||
      payload.browser.tabs.length !== 1 ||
      payload.browser.tabs[0]?.previewId !== payload.browser.pageId ||
      payload.browser.activeId !== payload.browser.pageId)
  )
    throw new Error('Invalid transferred Browser page')
  if (
    payload.terminal &&
    (payload.terminal.id !== item.payload?.terminalId ||
      typeof payload.terminal.output !== 'string')
  )
    throw new Error('Invalid transferred terminal output')
  return payload
}

/** Install renderer-owned state before the destination mounts the transferred work item. */
export function restoreTabTransferResources(payload: TabTransferPayload): void {
  if (payload.terminal) {
    resetTerminalOutput(payload.terminal.id)
    retainTerminalOutput(payload.terminal.id, payload.terminal.output)
  }
  if (payload.file) {
    const { sessionId, path, draft } = payload.file
    setFileDraft(sessionId, path, draft.content, {
      baseContent: draft.baseContent,
      baseHash: draft.baseHash,
    })
    const requestPath =
      typeof payload.item.payload?.path === 'string' ? payload.item.payload.path : path
    fileContentCache.putText(sessionId, requestPath, path, draft.baseContent, draft.baseHash)
  }
  if (payload.browser) {
    const { sessionId, tabs, activeId } = payload.browser
    const active = tabs.find((tab) => tab.previewId === activeId) ?? tabs[0]
    usePreviewStore.setState((state) => {
      const previewBySession = { ...state.previewBySession }
      if (active) previewBySession[sessionId] = active
      else delete previewBySession[sessionId]
      return {
        previewBySession,
        previewTabsBySession: { ...state.previewTabsBySession, [sessionId]: tabs },
      }
    })
  }
}

/** Source edits made during native creation stay visible instead of being discarded on acceptance. */
export function tabTransferStillCurrent(payload: TabTransferPayload, current: WorkItem): boolean {
  if (
    payload.item.id !== current.id ||
    payload.item.scope !== current.scope ||
    payload.item.kind !== current.kind
  )
    return false
  if (payload.file) {
    const { sessionId, path, draft } = payload.file
    const latest = getFileDraftSnapshot(sessionId, path)
    return latest?.content === draft.content && latest.baseHash === draft.baseHash
  }
  if (current.kind === 'file') {
    const session = sessionOfScope(current.scope)
    const path = typeof current.payload?.path === 'string' ? current.payload.path : undefined
    const resolved =
      session && path ? (fileContentCache.get(session, path)?.path ?? path) : undefined
    return (
      !current.isDirty && !(session && resolved && getFileDraft(session, resolved) !== undefined)
    )
  }
  if (payload.browser) {
    const { sessionId, tabs, activeId, pageId } = payload.browser
    const state = usePreviewStore.getState()
    if (pageId) {
      const page = state.previewTabsBySession[sessionId]?.find(
        (entry) => entry.previewId === pageId,
      )
      return !!page && JSON.stringify(page) === JSON.stringify(tabs[0])
    }
    return (
      JSON.stringify(state.previewTabsBySession[sessionId] ?? []) === JSON.stringify(tabs) &&
      (state.previewBySession[sessionId]?.previewId ?? null) === activeId
    )
  }
  return true
}
