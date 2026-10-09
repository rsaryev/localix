import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { publishFsChange } from '@/shared/lib/fsChangeBus'
import { publishFilesReloaded } from '@/shared/lib/fileReloadBus'
import { publishConflictResolved } from './conflictResolvedBus'
import { reloadGuard } from '../lib/reloadGuard'
import { fileEditorOwnerKey } from '../model/fileDrafts'
import { ApiError } from '@/shared/api/failure'
import { clearFileDraft } from '../model/fileDrafts'
import { fileContentCache } from '../model/fileContentCache'
import { registerDom } from '@localixai/kit/testing/dom'
import { setSaveCleanupPrefs } from '@/shared/ui/code-editor/saveCleanup'
import { useFileEditor, type FormatOnSaveRunner } from './useFileEditor'
import { WorkItemVisibilityProvider } from '@localixai/plugin-sdk/ui/visibility'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  setSaveCleanupPrefs({ trimTrailingWhitespace: false, ensureFinalNewline: false })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
beforeEach(() => {
  fileContentCache.clear()
  clearFileDraft('session-a', 'shared.ts')
  clearFileDraft('session-a', '/workspace/shared.ts')
})

type EditorSnapshot = ReturnType<typeof useFileEditor>

async function mountEditor(initialVisible = true, formatOnSave: FormatOnSaveRunner | null = null) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  let current: EditorSnapshot | null = null
  const formatOnSaveRef = { current: formatOnSave }

  function Harness() {
    current = useFileEditor('session-a', 'shared.ts', formatOnSaveRef)
    return null
  }

  let visible = initialVisible
  const render = async (nextVisible = visible) => {
    visible = nextVisible
    await act(async () => {
      root.render(
        <WorkItemVisibilityProvider visible={visible}>
          <Harness />
        </WorkItemVisibilityProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  await render()

  return {
    act,
    get current(): EditorSnapshot {
      if (!current) throw new Error('editor did not mount')
      return current
    },
    setVisible: render,
    unmount: () => act(async () => root.unmount()),
  }
}

function mockEditorBackend() {
  const get = spyOn(backendClient, 'getFileContent').mockResolvedValue({
    path: '/workspace/shared.ts',
    content: 'base',
    bytes: 4,
    truncated: false,
    hash: 'hash-base',
  })
  const open = spyOn(backendClient, 'lspOpen').mockResolvedValue(undefined)
  const change = spyOn(backendClient, 'lspChange').mockResolvedValue(undefined)
  const close = spyOn(backendClient, 'lspClose').mockResolvedValue(undefined)
  const saved = spyOn(backendClient, 'lspSave').mockResolvedValue(undefined)
  return {
    get,
    open,
    change,
    close,
    saved,
    restore() {
      get.mockRestore()
      open.mockRestore()
      change.mockRestore()
      close.mockRestore()
      saved.mockRestore()
    },
  }
}

describe('useFileEditor save ownership', () => {
  test('a transient read keeps a cold tab in a quiet reconnecting state', async () => {
    const backend = mockEditorBackend()
    backend.get.mockImplementation(async (_session, _path, options) => {
      options?.onRecovery?.()
      return await new Promise<never>(() => {})
    })
    const editor = await mountEditor()
    try {
      expect(editor.current.state).toEqual({ status: 'loading', reconnecting: true })
    } finally {
      await editor.unmount()
      backend.restore()
    }
  })

  test('a connection returning after recovery expired retries the failed cold load', async () => {
    let connected!: () => void
    const observer = spyOn(eventSocket, 'onConnected').mockImplementation((handler) => {
      connected = handler
      return () => {}
    })
    const backend = mockEditorBackend()
    backend.get.mockRejectedValueOnce(new ApiError('Offline', 0, 'network'))
    const editor = await mountEditor()
    try {
      expect(editor.current.state).toEqual({ status: 'loading', reconnecting: true })
      await editor.act(async () => {
        connected()
      })
      expect(editor.current.state.status).toBe('ready')
      expect(editor.current.buffer).toBe('base')
      expect(backend.get).toHaveBeenCalledTimes(2)
    } finally {
      await editor.unmount()
      backend.restore()
      observer.mockRestore()
    }
  })

  test('reconnect reopens the live LSP buffer without discarding unsaved typing', async () => {
    let reconnect!: () => void
    const observer = spyOn(eventSocket, 'onReconnect').mockImplementation((handler) => {
      reconnect = handler
      return () => {}
    })
    const backend = mockEditorBackend()
    const editor = await mountEditor()
    try {
      await editor.act(async () => editor.current.setBuffer('unsaved typing'))
      backend.get.mockResolvedValue({
        path: '/workspace/shared.ts',
        content: '',
        bytes: 4,
        truncated: false,
        hash: 'hash-base',
        unchanged: true,
      })
      await editor.act(async () => {
        reconnect()
      })
      expect(backend.open).toHaveBeenLastCalledWith(
        'session-a',
        '/workspace/shared.ts',
        'unsaved typing',
      )
      expect(editor.current.buffer).toBe('unsaved typing')
      expect(editor.current.dirty).toBe(true)
    } finally {
      await editor.unmount()
      backend.restore()
      observer.mockRestore()
    }
  })

  test('aborts a retired initial file read instead of only discarding its response', async () => {
    let loadSignal: AbortSignal | undefined
    const get = spyOn(backendClient, 'getFileContent').mockImplementation(
      async (_sessionId, _path, opts) => {
        loadSignal = opts?.signal
        return await new Promise<never>(() => {})
      },
    )
    const editor = await mountEditor()

    try {
      expect(loadSignal).toBeInstanceOf(AbortSignal)
      expect(loadSignal?.aborted).toBe(false)

      await editor.unmount()

      expect(loadSignal?.aborted).toBe(true)
    } finally {
      get.mockRestore()
    }
  })

  test('paints a cached snapshot before revalidation and never overwrites newer typing', async () => {
    fileContentCache.put('session-a', 'shared.ts', {
      path: '/workspace/shared.ts',
      content: 'cached',
      bytes: 6,
      truncated: false,
      hash: 'hash-cached',
    })
    const backend = mockEditorBackend()
    let finishRefresh!: (value: {
      path: string
      content: string
      bytes: number
      truncated: false
      hash: string
    }) => void
    const refresh = new Promise<{
      path: string
      content: string
      bytes: number
      truncated: false
      hash: string
    }>((resolve) => {
      finishRefresh = resolve
    })
    backend.get.mockImplementation(async () => await refresh)
    const editor = await mountEditor()

    try {
      // The backend is still pending, but the editor is already usable.
      expect(editor.current.state.status).toBe('ready')
      expect(editor.current.buffer).toBe('cached')
      expect(backend.get).toHaveBeenCalledWith('session-a', 'shared.ts', {
        full: true,
        knownHash: 'hash-cached',
        signal: expect.any(AbortSignal),
        onRecovery: expect.any(Function),
      })

      await editor.act(async () => editor.current.setBuffer('user typing'))
      finishRefresh({
        path: '/workspace/shared.ts',
        content: 'fresh disk',
        bytes: 10,
        truncated: false,
        hash: 'hash-fresh',
      })
      await editor.act(async () => {
        await refresh
        await Promise.resolve()
      })

      expect(editor.current.buffer).toBe('user typing')
      expect(editor.current.conflict).toEqual({
        diskContent: 'fresh disk',
        diskHash: 'hash-fresh',
      })
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      backend.restore()
    }
  })

  test('replaces a clean cache hit when revalidation can only return a truncated file', async () => {
    fileContentCache.put('session-a', 'shared.ts', {
      path: '/workspace/shared.ts',
      content: 'cached',
      bytes: 6,
      truncated: false,
      hash: 'hash-cached',
    })
    const backend = mockEditorBackend()
    backend.get.mockResolvedValue({
      path: '/workspace/shared.ts',
      content: 'truncated preview',
      bytes: 20_000_000,
      truncated: true,
    })
    const editor = await mountEditor()

    try {
      expect(editor.current.state).toMatchObject({
        status: 'ready',
        content: 'truncated preview',
        truncated: true,
        editable: false,
      })
      expect(editor.current.buffer).toBe('')
      expect(fileContentCache.get('session-a', 'shared.ts')).toBeUndefined()
    } finally {
      await editor.unmount()
      backend.restore()
    }
  })

  // `fs.changed` reaches only a connection that declares the session watched. With the Files rail
  // closed and no chat pane on the session, nothing declared it, so an open file never saw an
  // external write. The open editor declares it itself, and releases the declaration with the tab.
  test('an open editor watches its session so external writes reach it', async () => {
    const released: string[] = []
    const watch = spyOn(eventSocket, 'watchSession').mockImplementation((sessionId) => {
      return () => released.push(sessionId)
    })
    const backend = mockEditorBackend()
    const editor = await mountEditor(false)
    try {
      // A hidden editor ignores fs frames, so it has nothing to declare.
      expect(watch).toHaveBeenCalledTimes(0)
      await editor.setVisible(true)
      expect(watch).toHaveBeenCalledTimes(1)
      expect(watch).toHaveBeenLastCalledWith('session-a')
      await editor.unmount()
      expect(released).toEqual(['session-a'])
    } finally {
      clearFileDraft('session-a', '/workspace/shared.ts')
      backend.restore()
      watch.mockRestore()
    }
  })

  test('a warm-hidden editor defers its read and releases/reopens its LSP document', async () => {
    const backend = mockEditorBackend()
    const editor = await mountEditor(false)

    try {
      expect(backend.get).toHaveBeenCalledTimes(0)
      expect(backend.open).toHaveBeenCalledTimes(0)

      await editor.setVisible(true)
      expect(backend.get).toHaveBeenCalledTimes(1)
      expect(backend.open).toHaveBeenCalledTimes(1)
      expect(backend.open).toHaveBeenLastCalledWith('session-a', '/workspace/shared.ts', 'base')

      await editor.setVisible(false)
      expect(backend.close).toHaveBeenCalledTimes(1)

      await editor.setVisible(true)
      // One resume reconciliation catches a disk write missed while hidden; the
      // initial load itself is still cached and never runs a second time.
      expect(backend.get).toHaveBeenCalledTimes(2)
      expect(backend.open).toHaveBeenCalledTimes(2)
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      backend.restore()
    }
  })

  test('flushes same-tick typing once and suppresses LSP sync while hidden', async () => {
    const backend = mockEditorBackend()
    const editor = await mountEditor()
    try {
      await editor.act(async () => {
        editor.current.setBuffer('first edit')
        editor.current.flushLspSync()
        editor.current.flushLspSync()
        editor.current.setBuffer('second edit')
        editor.current.flushLspSync()
      })
      expect(backend.change.mock.calls).toEqual([
        ['session-a', '/workspace/shared.ts', 'first edit'],
        ['session-a', '/workspace/shared.ts', 'second edit'],
      ])
      await editor.setVisible(false)
      await editor.act(async () => {
        editor.current.setBuffer('hidden edit')
        editor.current.flushLspSync()
      })
      expect(backend.change).toHaveBeenCalledTimes(2)
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      backend.restore()
    }
  })

  test('resolved compare snapshots preserve later typing and reject a different owner', async () => {
    const backend = mockEditorBackend()
    const editor = await mountEditor()
    const resolution = {
      sessionId: 'session-a',
      editPath: '/workspace/shared.ts',
      expectedBuffer: 'base',
      content: 'resolved',
      hash: 'hash-resolved',
    }
    try {
      await editor.act(async () => {
        editor.current.setBuffer('later typing')
        publishConflictResolved({ ...resolution, sessionId: 'another-session' })
        publishConflictResolved({ ...resolution, editPath: '/workspace/other.ts' })
      })
      expect(editor.current.conflict).toBeNull()
      await editor.act(async () => publishConflictResolved(resolution))
      expect(editor.current.buffer).toBe('later typing')
      expect(editor.current.conflict).toEqual({
        diskContent: 'resolved',
        diskHash: 'hash-resolved',
      })
      await editor.act(async () =>
        publishConflictResolved({ ...resolution, expectedBuffer: 'later typing' }),
      )
      expect(editor.current.buffer).toBe('resolved')
      expect(editor.current.baseHash).toBe('hash-resolved')
      expect(editor.current.conflict).toBeNull()
      expect(editor.current.dirty).toBe(false)
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      backend.restore()
    }
  })

  test('visible file signals schedule owned reloads and hiding cancels pending work', async () => {
    const backend = mockEditorBackend()
    const scheduled: Array<{ key: string; run: () => void }> = []
    const schedule = spyOn(reloadGuard, 'scheduleReload').mockImplementation((key, run) => {
      scheduled.push({ key, run })
    })
    const cancel = spyOn(reloadGuard, 'cancel')
    const editor = await mountEditor()
    try {
      publishFsChange({ sessionId: 'another-session', paths: ['/workspace'] })
      publishFsChange({ sessionId: 'session-a', paths: ['/elsewhere'] })
      publishFilesReloaded(['/workspace/other.ts'])
      expect(scheduled).toEqual([])
      publishFsChange({ sessionId: 'session-a', paths: ['/workspace'] })
      publishFilesReloaded(['/workspace/shared.ts'])
      const owner = fileEditorOwnerKey('session-a', '/workspace/shared.ts')
      expect(scheduled.map(({ key }) => key)).toEqual([owner, owner])
      // The callback must inspect live typing, not the clean buffer at scheduling time.
      await editor.act(async () => editor.current.setBuffer('new typing'))
      backend.get.mockResolvedValueOnce({
        path: '/workspace/shared.ts',
        content: 'external write',
        bytes: 14,
        truncated: false,
        hash: 'hash-external',
      })
      await editor.act(async () => scheduled[0]!.run())
      expect(editor.current.buffer).toBe('new typing')
      expect(editor.current.conflict).toEqual({
        diskContent: 'external write',
        diskHash: 'hash-external',
      })
      await editor.setVisible(false)
      expect(cancel).toHaveBeenCalledWith(owner)
      publishFsChange({ sessionId: 'session-a', paths: ['/workspace'] })
      publishFilesReloaded(['/workspace/shared.ts'])
      expect(scheduled).toHaveLength(2)
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      backend.restore()
      schedule.mockRestore()
      cancel.mockRestore()
    }
  })

  test('joins duplicate saves and does not clobber edits typed during the write', async () => {
    setSaveCleanupPrefs({ trimTrailingWhitespace: false, ensureFinalNewline: false })
    const backend = mockEditorBackend()
    let finishWrite!: (value: { path: string; bytes: number; hash: string }) => void
    const writeResult = new Promise<{ path: string; bytes: number; hash: string }>((resolve) => {
      finishWrite = resolve
    })
    const write = spyOn(backendClient, 'writeFileContent').mockImplementation(
      async () => await writeResult,
    )
    const editor = await mountEditor()

    try {
      await editor.act(async () => editor.current.setBuffer('save snapshot'))
      let first!: Promise<boolean>
      let duplicate!: Promise<boolean>
      await editor.act(async () => {
        first = editor.current.save()
        duplicate = editor.current.save()
        await Promise.resolve()
      })
      expect(duplicate).toBe(first)
      expect(write).toHaveBeenCalledTimes(1)

      await editor.act(async () => editor.current.setBuffer('newer edits'))
      finishWrite({ path: '/workspace/shared.ts', bytes: 13, hash: 'hash-saved' })
      await editor.act(async () => {
        expect(await first).toBe(true)
      })

      expect(editor.current.buffer).toBe('newer edits')
      expect(editor.current.dirty).toBe(true)
      expect(write).toHaveBeenCalledTimes(1)
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      write.mockRestore()
      backend.restore()
    }
  })

  test('returns false when persistence fails', async () => {
    setSaveCleanupPrefs({ trimTrailingWhitespace: false, ensureFinalNewline: false })
    const backend = mockEditorBackend()
    const write = spyOn(backendClient, 'writeFileContent').mockRejectedValue(new Error('offline'))
    const editor = await mountEditor()

    try {
      await editor.act(async () => editor.current.setBuffer('unsaved'))
      await editor.act(async () => {
        expect(await editor.current.save()).toBe(false)
      })
      expect(editor.current.buffer).toBe('unsaved')
      expect(editor.current.dirty).toBe(true)
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      write.mockRestore()
      backend.restore()
    }
  })

  test('adopts the exact cleanup-transformed bytes that were written', async () => {
    setSaveCleanupPrefs({ trimTrailingWhitespace: true, ensureFinalNewline: true })
    const backend = mockEditorBackend()
    const write = spyOn(backendClient, 'writeFileContent').mockResolvedValue({
      path: '/workspace/shared.ts',
      bytes: 8,
      hash: 'hash-clean',
    })
    const editor = await mountEditor()

    try {
      await editor.act(async () => editor.current.setBuffer('changed  '))
      await editor.act(async () => {
        expect(await editor.current.save()).toBe(true)
      })

      expect(write).toHaveBeenCalledWith('session-a', 'shared.ts', 'changed\n', 'hash-base')
      expect(editor.current.buffer).toBe('changed\n')
      expect(editor.current.dirty).toBe(false)
      expect(fileContentCache.get('session-a', 'shared.ts')).toMatchObject({
        content: 'changed\n',
        hash: 'hash-clean',
      })
      // A save is the one moment the language server hears "saved" (never per keystroke).
      expect(backend.saved).toHaveBeenCalledTimes(1)
      expect(backend.saved).toHaveBeenCalledWith('session-a', '/workspace/shared.ts')
    } finally {
      setSaveCleanupPrefs({ trimTrailingWhitespace: false, ensureFinalNewline: false })
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      write.mockRestore()
      backend.restore()
    }
  })

  test('format-on-save formats the buffer in memory and writes ONCE', async () => {
    // It used to write the raw buffer, let the server format the file on disk, re-read it
    // and write again — two writes and a window where any other writer passed for the
    // formatter. Now the formatter answers for the buffer and the save writes its result.
    const backend = mockEditorBackend()
    const write = spyOn(backendClient, 'writeFileContent').mockResolvedValue({
      path: '/workspace/shared.ts',
      bytes: 12,
      hash: 'hash-formatted',
    })
    const formatted: string[] = []
    const editor = await mountEditor(true, async (text) => {
      formatted.push(text)
      return `${text.trim()};`
    })

    try {
      await editor.act(async () => editor.current.setBuffer('let a = 1'))
      const readsBefore = backend.get.mock.calls.length
      await editor.act(async () => {
        expect(await editor.current.save()).toBe(true)
      })

      expect(formatted).toEqual(['let a = 1'])
      expect(write).toHaveBeenCalledTimes(1)
      expect(write).toHaveBeenCalledWith('session-a', 'shared.ts', 'let a = 1;', 'hash-base')
      // No read-back of the formatter's output from disk.
      expect(backend.get.mock.calls.length).toBe(readsBefore)
      // The formatter was asked about exactly the text the server holds.
      expect(backend.change).toHaveBeenCalledWith('session-a', '/workspace/shared.ts', 'let a = 1')
      expect(editor.current.buffer).toBe('let a = 1;')
      expect(editor.current.dirty).toBe(false)
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      write.mockRestore()
      backend.restore()
    }
  })

  test('reconcile is a conditional read and an unchanged answer leaves the buffer alone', async () => {
    const backend = mockEditorBackend()
    const editor = await mountEditor()

    try {
      // Initial load is an unconditional full read — there is no base hash yet.
      expect(backend.get).toHaveBeenLastCalledWith('session-a', 'shared.ts', {
        full: true,
        signal: expect.any(AbortSignal),
        onRecovery: expect.any(Function),
      })

      // Hide/show forces the resume reconcile. It must carry the loaded hash so the
      // server can skip the body, and an empty `unchanged` response must not be
      // adopted as the new (blank) file content.
      backend.get.mockResolvedValueOnce({
        path: '/workspace/shared.ts',
        content: '',
        bytes: 4,
        truncated: false,
        hash: 'hash-base',
        unchanged: true,
      })
      await editor.setVisible(false)
      await editor.setVisible(true)

      expect(backend.get).toHaveBeenLastCalledWith('session-a', '/workspace/shared.ts', {
        full: true,
        knownHash: 'hash-base',
      })
      expect(editor.current.buffer).toBe('base')
      expect(editor.current.dirty).toBe(false)
      expect(editor.current.externalChanges).toBeUndefined()
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      backend.restore()
    }
  })

  test('a clean buffer adopting an external write says which lines it changed', async () => {
    // The complaint: an agent edited the open file and the tab swapped the text silently.
    const backend = mockEditorBackend()
    const editor = await mountEditor()

    try {
      backend.get.mockResolvedValueOnce({
        path: '/workspace/shared.ts',
        content: 'base\nadded by the agent',
        bytes: 24,
        truncated: false,
        hash: 'hash-agent',
      })
      await editor.setVisible(false)
      await editor.setVisible(true)

      expect(editor.current.buffer).toBe('base\nadded by the agent')
      expect(editor.current.dirty).toBe(false)
      expect(editor.current.externalChanges).toEqual([{ fromLine: 2, toLine: 2, type: 'added' }])
    } finally {
      await editor.unmount()
      clearFileDraft('session-a', '/workspace/shared.ts')
      backend.restore()
    }
  })
})
