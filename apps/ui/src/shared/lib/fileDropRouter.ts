// Drag-to-open router — turns an UNCLAIMED OS-file drop (one no zone handled —
// see fileDropGuard) into opened tabs. Two routes:
//
// - DESKTOP (Tauri shell, macOS): the shell's `dragged_paths` command reads the
//   just-dropped files' REAL absolute paths off the system DRAG pasteboard
//   (Tauri's native drag-drop handler stays DISABLED — it would swallow all
//   in-page HTML5 DnD; see lib.rs — so the drop itself is a normal HTML5 event
//   whose `File`s hide the path). When the pasteboard matches the drop exactly
//   (strict name pairing — `droppedPathMatch.ts`), a file opens EDITABLE at its
//   real path (⌘S saves in place, no copy) and a folder opens as
//   a project (same find-or-create resolve the `localix <dir>` deep link uses).
//
// - WEB (or a desktop mismatch/stale pasteboard): a browser `File` never
//   exposes an absolute path, so the drop materializes into the media store and
//   opens by content id (READ-ONLY). Content-addressed, so re-dropping the same
//   file de-dupes. The editor-grid registry routes each media id by name — pdf
//   → native PDF view, office doc → read-only markdown, csv/xlsx → a table, and
//   everything else (images, markdown, yaml, code, text, …) → the read-only
//   media viewer. So "drop any file" opens rather than being turned away.

import { toast } from '@/shared/lib/notify'
import { inspector } from './inspectorBus'
import { pageOpenChatOrNotify } from './pageOpenChat'
import { isDesktop } from '@localixai/kit/environment'
import { tauriInvoke } from './tauri'
import { matchDroppedPaths, parseDraggedPaths, type DraggedPathEntry } from './droppedPathMatch'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { errorDetail } from '@/shared/api/internal'
import { uploadMedia } from '@/shared/api/media-client'
import { backendClient } from '@/shared/api/client'
import { scopePath } from '@/shared/routing/routes'

/** Human list of names, capped so a bulk drop can't produce a wall-of-text toast. */
function nameList(names: string[]): string {
  const head = names.slice(0, 3).join(', ')
  return names.length > 3 ? `${head} +${names.length - 3} more` : head
}

/**
 * DESKTOP: recover the dropped files' absolute paths from the shell's drag
 * pasteboard and pair them with the HTML5 file list. Null (→ media fallback)
 * outside the shell, on invoke failure, or when the pasteboard doesn't match
 * the drop exactly (stale contents, drag from a non-Finder source).
 */
export async function desktopDroppedEntries(
  files: readonly File[],
): Promise<DraggedPathEntry[] | null> {
  if (!isDesktop) return null
  const invoke = tauriInvoke()
  if (!invoke) return null
  try {
    const entries = parseDraggedPaths(await invoke('dragged_paths'))
    return matchDroppedPaths(
      files.map((f) => f.name),
      entries,
    )
  } catch {
    return null
  }
}

/**
 * Open a dropped FOLDER as a project — the same find-or-create resolve the
 * `localix <path>` deep link takes (openDeepLinkPath), minus the
 * file part. Best-effort: a failed resolve degrades to a toast, not a crash.
 */
async function openDroppedFolder(path: string): Promise<void> {
  try {
    const { project } = await backendClient.resolveProjectByPath(path)
    window.location.hash = `#${scopePath(project.id)}`
  } catch (e) {
    // An EVENT, not a standing condition: a drop that failed does not stay true until someone
    // fixes it — the next drop is a new fact. Published as a condition it would sit in the centre
    // asserting a failed drag forever, because nothing can ever settle it.
    // The reason used to be dropped here, which made "server unreachable" and "not a directory"
    // the same dead end. The transport classifies its own failures, so the line is a sentence and
    // whatever it could not classify stays exact underneath.
    toast.error(`Could not open the folder “${path}”`, {
      description: errorMessage(e, 'That folder could not be opened as a project.'),
    })
  }
}

/**
 * Route dropped OS files. Desktop-with-real-paths opens each file editable in
 * place (folder → project); otherwise each file uploads into the media store
 * and opens by `mediaId` in its read-only viewer. Best-effort per file — one
 * failure doesn't abort the others.
 */
export async function routeDroppedFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return

  // A dropped FILE opens in the chat that is open (the page publishes it): an OS drop belongs to
  // no chat surface, so with none open it is refused out loud rather than put in a guessed one. A
  // folder opens a project and needs no chat.
  const entries = await desktopDroppedEntries(files)
  if (entries) {
    const fileEntries = entries.filter((entry) => !entry.isDir)
    for (const entry of entries) if (entry.isDir) void openDroppedFolder(entry.path)
    if (fileEntries.length === 0) return
    const sessionId = pageOpenChatOrNotify()
    if (!sessionId) return
    for (const entry of fileEntries) inspector.openFile({ sessionId, path: entry.path })
    return
  }

  // Nothing is uploaded for a drop that has no chat to open in.
  const session = pageOpenChatOrNotify()
  if (!session) return
  const failed: Array<{ name: string; reason: string; detail?: string }> = []
  await Promise.all(
    files.map(async (file) => {
      try {
        const { id, name } = await uploadMedia(file)
        inspector.openMediaFile({ sessionId: session, mediaId: id, name })
      } catch (e) {
        failed.push({
          name: file.name,
          reason: errorMessage(e, 'This file could not be opened.'),
          detail: errorDetail(e),
        })
      }
    }),
  )

  if (failed.length > 0) {
    const names = nameList(failed.map((f) => `“${f.name}”`))
    // One line per file, not one sentence about the first of them: five files can fail five
    // different ways (server down, upload rejected, proxy error) and the flattened toast reported
    // only one of the reasons. An EVENT, not a condition — see `openDroppedFolder`.
    toast.error(`Could not open ${names}`, {
      description: failed
        .map((f) => [`${f.name} — ${f.reason}`, ...(f.detail ? [`  ${f.detail}`] : [])].join('\n'))
        .join('\n'),
    })
  }
}
