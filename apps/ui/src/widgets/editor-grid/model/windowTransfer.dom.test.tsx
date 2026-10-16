import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { emptyEditorState, useGridStore, type WorkItem } from '@/features/workspace-grid/model'
import { useChatStore } from '@/features/chat/model/store'
import type { UiSession } from '@/shared/api/ui-session'
import {
  configurePlatformCapabilities,
  type PlatformCapabilities,
} from '@/shared/lib/platformCapabilities'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import {
  fileTransferReadyKey,
  terminalTransferReadyKey,
  workItemTransferReady,
} from '@/shared/lib/workItemTransferReady'
import { fileContentCache } from '@/features/inspector/model/fileContentCache'
import {
  clearFileDraft,
  getFileDraftSnapshot,
  setFileDraft,
} from '@/features/inspector/model/fileDrafts'
import { usePreviewStore } from '@/features/inspector/model/previewStore'
import {
  resetTerminalOutput,
  retainTerminalOutput,
  terminalOutput,
} from '@/features/terminal/model/terminalOutput'
import { moveTabToWorkspaceWindow } from './windowTransfer'
import {
  prepareTabTransfer,
  readTabTransferPayload,
  tabTransferStillCurrent,
} from './windowTransferPayload'
import { receiveWorkspaceTabTransfer } from './useWorkspaceTabTransfer'
import { acknowledgeTransferredLayout } from './workspaceTransferLayout'
import { syncGridChatSelection } from './useGridChatSync'

const originalGrid = useGridStore.getState()
const originalChat = useChatStore.getState()
const originalPreviews = usePreviewStore.getState()
let teardown: () => Promise<void>
let restorePort: (() => void) | undefined
const originalRaf = globalThis.requestAnimationFrame
function mountTransferredPanel(id: string) {
  const root = document.createElement('div')
  root.innerHTML = '<div data-work-item-id></div>'
  root.firstElementChild!.setAttribute('data-work-item-id', id)
  document.body.append(root)
  acknowledgeTransferredLayout(root)
  root.remove()
}
const terminal: WorkItem = {
  id: 'terminal:transfer-test',
  kind: 'terminal',
  title: 'Build',
  scope: 'transfer-session',
  payload: { terminalId: 'transfer-test', sessionId: 'transfer-session', owned: true },
}
const file: WorkItem = {
  id: 'file:transfer-test',
  kind: 'file',
  title: 'Draft',
  scope: 'transfer-session',
  payload: { path: '/workspace/draft.ts' },
  isDirty: true,
}
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})
beforeEach(() => {
  useGridStore.setState(emptyEditorState('source-group'))
  useChatStore.setState({
    activeProjectId: 'transfer-project',
    activeSessionId: 'transfer-session',
    sessions: [],
    allSessions: [{ id: 'transfer-session', projectId: 'transfer-project' } as UiSession],
  })
  syncGridChatSelection(useGridStore.getState(), 'transfer-session', 'Chat', null)
  // Hidden WebKit never delivers the requested frame until the native window is shown.
  globalThis.requestAnimationFrame = () => 1
})
afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf
  restorePort?.()
  restorePort = undefined
  for (const id of [terminal.id, file.id]) {
    workItemTransferState.finish(id)
    workItemTransferState.attached(id)
    workItemTransferState.acceptReceived(id)
  }
  clearFileDraft('transfer-session', '/workspace/draft.ts')
  fileContentCache.clear()
  resetTerminalOutput('transfer-test')
  useGridStore.setState(originalGrid)
  useChatStore.setState(originalChat)
  usePreviewStore.setState(originalPreviews)
})

function installInvoke(
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  restorePort = configurePlatformCapabilities({
    desktop: {
      invoke: invoke as PlatformCapabilities['desktop']['invoke'],
    },
  })
}

test('keeps the source terminal until destination ACK and moves without a closed-tab entry', async () => {
  useGridStore.getState().openItem(terminal)
  let accept!: (label: string) => void
  installInvoke((_command, args) => {
    expect(args?.payload).toMatchObject({ item: terminal, projectId: 'transfer-project' })
    return new Promise<string>((resolve) => {
      accept = resolve
    })
  })
  const moving = moveTabToWorkspaceWindow(terminal.id, 'window')
  expect(useGridStore.getState().items[terminal.id]).toBeDefined()
  expect(workItemTransferState.pending(terminal.id)).toBe(true)
  accept('workspace-target')
  expect(await moving).toBe(true)
  expect(useGridStore.getState().items[terminal.id]).toBeUndefined()
  expect(useGridStore.getState().closed).toEqual([])
  expect(workItemTransferState.departed(terminal.id)).toBe(true)
})

test('a rejected native transfer leaves the owned source terminal intact', async () => {
  useGridStore.getState().openItem(terminal)
  installInvoke(async () => {
    throw new Error('creation failed')
  })
  expect(await moveTabToWorkspaceWindow(terminal.id, 'tab')).toBe(false)
  expect(useGridStore.getState().items[terminal.id]?.payload?.owned).toBe(true)
  expect(workItemTransferState.departed(terminal.id)).toBe(false)
})

test('dirty files require a complete snapshot and retain newer edits during the handshake', async () => {
  useGridStore.getState().openItem(file)
  expect(() => prepareTabTransfer(file)).toThrow('unsaved file is not ready')
  setFileDraft('transfer-session', '/workspace/draft.ts', 'draft', {
    baseContent: 'base',
    baseHash: 'old-hash',
  })
  let accept!: (label: string) => void
  installInvoke(
    () =>
      new Promise<string>((resolve) => {
        accept = resolve
      }),
  )
  const moving = moveTabToWorkspaceWindow(file.id, 'window')
  setFileDraft('transfer-session', '/workspace/draft.ts', 'newer draft', {
    baseContent: 'base',
    baseHash: 'old-hash',
  })
  accept('workspace-target')
  expect(await moving).toBe(false)
  expect(useGridStore.getState().items[file.id]).toBeDefined()
  expect(getFileDraftSnapshot('transfer-session', '/workspace/draft.ts')?.content).toBe(
    'newer draft',
  )
})

test('Browser navigation or a new tab while moving keeps the original Browser', () => {
  const browser: WorkItem = {
    kind: 'preview',
    id: 'preview@transfer-session',
    title: 'Browser',
    scope: 'transfer-session',
  }
  const page = { previewId: 'browser-transfer-page', url: 'https://example.com', version: 0 }
  usePreviewStore.setState({
    previewTabsBySession: { 'transfer-session': [page] },
    previewBySession: { 'transfer-session': page },
  })
  const { payload } = prepareTabTransfer(browser)
  expect(tabTransferStillCurrent(payload, browser)).toBe(true)
  usePreviewStore
    .getState()
    .updateBrowserTab('transfer-session', page.previewId, { url: 'https://example.com/next' })
  expect(tabTransferStillCurrent(payload, browser)).toBe(false)
})

test('destination exposes prepared resources before ACK and preserves the unsaved concurrency baseline', async () => {
  setFileDraft('transfer-session', '/workspace/draft.ts', 'draft', {
    baseContent: 'base',
    baseHash: 'old-hash',
  })
  const { payload } = prepareTabTransfer(file)
  clearFileDraft('transfer-session', '/workspace/draft.ts')
  let prepared = false
  const commands: string[] = []
  installInvoke(async (command) => {
    commands.push(command)
    if (command === 'workspace_transfer_take') return { sourceWindow: 'main', payload }
    expect(prepared).toBe(true)
    expect(useGridStore.getState().items[file.id]).toBeDefined()
    return undefined
  })
  await receiveWorkspaceTabTransfer(() => {
    prepared = true
    mountTransferredPanel(file.id)
    expect(getFileDraftSnapshot('transfer-session', '/workspace/draft.ts')).toEqual({
      content: 'draft',
      baseContent: 'base',
      baseHash: 'old-hash',
    })
    expect(Object.keys(useGridStore.getState().items)).toEqual([file.id])
    workItemTransferReady.success(fileTransferReadyKey('transfer-session', '/workspace/draft.ts'))
  })
  expect(commands).toEqual([
    'workspace_transfer_take',
    'workspace_transfer_presented',
    'workspace_transfer_ready',
  ])
  expect(fileContentCache.get('transfer-session', '/workspace/draft.ts')?.hash).toBe('old-hash')
})

test('dead terminal output is transferred and missing archives fail without source removal', () => {
  const dead = { ...terminal, payload: { ...terminal.payload, terminalExit: { exitCode: 1 } } }
  expect(() => prepareTabTransfer(dead)).toThrow('no cached output')
  retainTerminalOutput('transfer-test', 'compiler failed\r\n')
  const { payload } = prepareTabTransfer(dead)
  expect(payload.terminal?.output).toBe(terminalOutput('transfer-test'))
  expect(readTabTransferPayload(payload).item.payload?.terminalId).toBe('transfer-test')
  expect(() =>
    readTabTransferPayload({ ...payload, terminal: { id: 'other', output: 'bad' } }),
  ).toThrow()
})

test('hidden destination presents mounted content without RAF and waits for terminal ACK', async () => {
  const { payload } = prepareTabTransfer(terminal)
  const commands: string[] = []
  installInvoke(async (command) => {
    commands.push(command)
    return command === 'workspace_transfer_take' ? { sourceWindow: 'main', payload } : undefined
  })
  let prepared!: () => void
  const mounted = new Promise<void>((resolve) => {
    prepared = resolve
  })
  const receiving = receiveWorkspaceTabTransfer(() => {
    prepared()
    mountTransferredPanel(terminal.id)
  })
  await mounted
  expect(commands).toEqual(['workspace_transfer_take'])
  expect(workItemTransferState.unaccepted(terminal.id)).toBe(true)
  workItemTransferReady.success(terminalTransferReadyKey('transfer-test'))
  await receiving
  expect(commands).toEqual([
    'workspace_transfer_take',
    'workspace_transfer_presented',
    'workspace_transfer_ready',
  ])
  expect(workItemTransferState.unaccepted(terminal.id)).toBe(false)
})

test('a destination connection failure never ACKs or takes ownership of the source PTY', async () => {
  const { payload } = prepareTabTransfer(terminal)
  const commands: string[] = []
  installInvoke(async (command) => {
    commands.push(command)
    return command === 'workspace_transfer_take' ? { sourceWindow: 'main', payload } : undefined
  })
  await expect(
    receiveWorkspaceTabTransfer(() => {
      mountTransferredPanel(terminal.id)
      workItemTransferReady.failure(terminalTransferReadyKey('transfer-test'), 'unavailable')
    }),
  ).rejects.toThrow('unavailable')
  expect(commands).toEqual(['workspace_transfer_take', 'workspace_transfer_presented'])
  expect(useGridStore.getState().items[terminal.id]?.payload?.owned).toBe(false)
  expect(workItemTransferState.unaccepted(terminal.id)).toBe(true)
})

test('restoration waits for the route layout selection without waiting for a frame', async () => {
  const { payload } = prepareTabTransfer(terminal)
  useGridStore.setState(emptyEditorState('initial'))
  const commands: string[] = []
  installInvoke(async (command) => {
    commands.push(command)
    return command === 'workspace_transfer_take' ? { sourceWindow: 'main', payload } : undefined
  })
  const receiving = receiveWorkspaceTabTransfer(() => {
    mountTransferredPanel(terminal.id)
    workItemTransferReady.success(terminalTransferReadyKey('transfer-test'))
  })
  await Promise.resolve()
  expect(useGridStore.getState().items[terminal.id]).toBeUndefined()
  expect(commands).toEqual(['workspace_transfer_take'])
  syncGridChatSelection(useGridStore.getState(), 'transfer-session', 'Chat', null)
  await receiving
  expect(Object.keys(useGridStore.getState().items)).toEqual([terminal.id])
})
