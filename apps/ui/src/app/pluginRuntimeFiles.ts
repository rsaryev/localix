/**
 * The `files` half of the plugin UI runtime — saving, downloading, picking and reading files, plus
 * announcing that paths changed on disk.
 *
 * Extracted from `pluginRuntime.ts`, which is a composition root: it grew past the module size
 * limit because every new seam adds another block to one object literal. Splitting by AREA keeps
 * each block reviewable next to the host modules it wires, and the root stays a list of areas.
 */
import { publishFilesReloaded } from '@/shared/lib/fileReloadBus'
import { API_BASE_URL, apiFetch } from '@/shared/api/internal'
import { saveViaDesktop, webDownloadBlob } from '@/shared/lib/desktopSave'
import { desktopDroppedEntries } from '@/shared/lib/fileDropRouter'
import { uploadMedia } from '@/shared/api/media-client'
import { mediaFileBinding } from '@/shared/lib/mediaFileBinding'
import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { isDesktop } from '@localixai/kit/environment'
import { projectsApi } from '@/shared/api/projects-client'
import { toast } from '@/shared/lib/notify'
import {
  createMessageBindingDraft,
  type PluginUiRuntime,
  type PluginWorkspaceWatchHandlers,
} from '@localixai/mini-app-sdk/ui'
import { onFsChange } from '@/shared/lib/fsChangeBus'
import { eventSocket } from '@/shared/api/eventSocket'

export function createPluginFilesRuntime(): PluginUiRuntime['files'] {
  return {
    announceReloaded: (paths) => publishFilesReloaded(paths),
    saveBlob: (filename, blob) => {
      if (!saveViaDesktop(filename, blob)) webDownloadBlob(filename, blob)
    },
    download: async (path, filename) => {
      const url = `${API_BASE_URL}${path}`
      if (isDesktop) {
        const blob = await (await apiFetch(url)).blob()
        if (saveViaDesktop(filename, blob)) return
      }
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    },
    pickFiles: (options) => projectsApi.pickFiles(options),
    bindingsFromFiles: async (files) => {
      const entries = await desktopDroppedEntries(files)
      if (entries) {
        // One drop is one act: dropping five folders that cannot be projects used to write five
        // durable rows. The failures are collected and said once, with the count.
        const refused: { label: string; error: unknown }[] = []
        const bindings = await Promise.all(
          entries.map(async (entry, index) => {
            const label =
              files[index]?.name ||
              entry.path.split('/').findLast((segment) => segment.length > 0) ||
              entry.path
            if (!entry.isDir) return createMessageBindingDraft('file', entry.path, label)
            try {
              const result = await projectsApi.resolveProjectByPath(entry.path)
              return createMessageBindingDraft('project', result.project.id, result.project.name)
            } catch (error) {
              // Dropping a folder that cannot be opened as a project used to attach nothing at
              // all: the drag simply had no effect, and the person had no way to learn why.
              refused.push({ label, error })
              return null
            }
          }),
        )
        const [first] = refused
        if (first && refused.length === 1) {
          toast.error(`Could not attach “${first.label}” as a project`, {
            description: errorMessage(first.error, '') || undefined,
          })
        } else if (first) {
          toast.error(`Could not attach ${refused.length} folders as projects`, {
            description: refused
              .map(({ label, error }) => `“${label}”: ${errorMessage(error, 'not a project')}`)
              .join('\n'),
          })
        }
        return bindings.filter((binding) => binding !== null)
      }

      return Promise.all(
        files.map(async (file) => {
          const stored = await uploadMedia(file)
          return mediaFileBinding(stored)
        }),
      )
    },
    droppedPaths: (files) => desktopDroppedEntries(files),
    read: (sessionId, path, options) => backendClient.getFileContent(sessionId, path, options),
    watchWorkspace: (sessionId, handlers) => watchWorkspace(sessionId, handlers),
  }
}

/**
 * One chat's slice of the `fs.changed` relay, for a plugin that holds it.
 *
 * The API arms a session's watcher only when its tree is LISTED (`listDirectory`), so a plugin
 * whose chat never opened the file tree would wait on a watcher nobody started; the root listing
 * here is that arm, and its `live` answer is the plugin's. Re-armed after a reconnect (the server
 * may have restarted and lost its watchers) and after a coarse signal (how a failing watcher asks
 * to be re-listed), and each of those is passed on coarse: changes may have been missed.
 *
 * The holder also DECLARES the chat as rendered (`watchSession`): the server delivers `fs.changed`
 * only to connections watching that session, so a plugin surface in a chat with no mounted chat
 * pane or tree would be told it is live and then never hear a change.
 */
export function watchWorkspace(
  sessionId: string,
  handlers: PluginWorkspaceWatchHandlers,
  deps: {
    listDirectory: (sessionId: string) => Promise<{ live?: boolean }>
    onFsChange: typeof onFsChange
    onReconnect: (handler: () => void) => () => void
    onDisconnect?: (handler: () => void) => () => void
    watchSession: (sessionId: string) => () => void
  } = {
    listDirectory: (id) => backendClient.listDirectory(id),
    onFsChange,
    onReconnect: (handler) => eventSocket.onReconnect(handler),
    onDisconnect: (handler) => eventSocket.onDisconnect(handler),
    watchSession: (id) => eventSocket.watchSession(id),
  },
): () => void {
  let closed = false
  const unwatch = deps.watchSession(sessionId)
  let attempt = 0
  let connected = true
  const arm = () => {
    const ticket = ++attempt
    void deps.listDirectory(sessionId).then(
      (listing) => {
        if (!closed && connected && ticket === attempt) handlers.onLive(listing.live === true)
      },
      () => {
        if (!closed && connected && ticket === attempt) handlers.onLive(false)
      },
    )
  }
  const offDisconnect = deps.onDisconnect?.(() => {
    connected = false
    attempt++
    handlers.onLive(false)
  })
  const offChange = deps.onFsChange((change) => {
    if (closed || change.sessionId !== sessionId) return
    const coarse = change.paths.length === 0
    handlers.onChange(change.changedPaths ?? (coarse ? null : change.paths))
    if (change.live === false) {
      attempt++
      handlers.onLive(false)
    } else if (coarse) arm()
  })
  const offReconnect = deps.onReconnect(() => {
    if (closed) return
    connected = true
    handlers.onChange(null)
    arm()
  })
  arm()
  return () => {
    closed = true
    offChange()
    offReconnect()
    offDisconnect?.()
    unwatch()
  }
}
