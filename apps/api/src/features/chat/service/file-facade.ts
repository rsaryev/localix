import type { FileOpsContext } from './file-ops'
import * as fileOps from './file-ops'
import { openSessionEnv } from './file-ops-context'
import type { createFileWatchService } from '../../fs-watch/service'

/**
 * The workspace-file half of the chat service's surface.
 *
 * Every method here is a delegation to `service/file-ops` with the same context — which is what
 * makes the group a group, and what made keeping it inside a 1,400-line `return {}` pointless.
 * The exceptions carry real decisions and are why this is a facade rather than a re-export:
 * every listing and every file read arms the live tree watcher, and `resolveSessionCwd` is the
 * workspace metadata read narrowed to its one field.
 */
export interface ChatFileFacadeDeps {
  fileOpsCtx: FileOpsContext
  fileWatchService: ReturnType<typeof createFileWatchService>
  resolveSessionWorkspaceMetadata: (
    userId: string,
    sessionId: string,
  ) => Promise<{ rootPath: string; projectId: string | null }>
}

export function createChatFileFacade({
  fileOpsCtx,
  fileWatchService,
  resolveSessionWorkspaceMetadata,
}: ChatFileFacadeDeps) {
  return {
    async resolveSessionCwd(userId: string, sessionId: string): Promise<string> {
      return (await resolveSessionWorkspaceMetadata(userId, sessionId)).rootPath
    },

    /**
     * Edit prediction needs the effective root and project exclusions together.
     * Return both from the same owner-scoped session read so callers never load
     * SessionDetail and its transcript merely to recover projectId.
     */
    resolveSessionWorkspaceMetadata,

    /**
     * The session, its backend-aware execution environment and its working dir — for a host
     * feature that keeps files beside the session's own (the plan's draft and snapshots), so it
     * reaches them on ssh/docker the way the viewer does instead of through local `fs`.
     */
    sessionEnvironment(userId: string, sessionId: string) {
      return openSessionEnv(fileOpsCtx, userId, sessionId)
    },

    async readFile(
      userId: string,
      sessionId: string,
      filePath: string,
      opts?: { full?: boolean; knownHash?: string; signal?: AbortSignal },
    ) {
      // A read arms the watcher too. An editor can be open on a file whose tree was never
      // listed (a restored tab, a link from the transcript, a server restart while the file
      // stayed open), and with only listings arming, no watcher existed to send it `fs.changed`
      // — a terminal edit or a branch switch left the buffer silently stale. Not awaited: the
      // read's answer does not depend on it, and arming an already-live root is a recency bump.
      void fileWatchService.arm(userId, sessionId).catch(() => false)
      return fileOps.readFile(fileOpsCtx, userId, sessionId, filePath, opts)
    },

    async writeFile(
      userId: string,
      sessionId: string,
      filePath: string,
      content: string,
      baseHash: string,
    ) {
      return fileOps.writeFile(fileOpsCtx, userId, sessionId, filePath, content, baseHash)
    },

    async listDirectory(userId: string, sessionId: string, dirPath?: string) {
      // EVERY listing (re-)arms the live tree watcher, not just the root one: a watcher lost to
      // a server restart, eviction or a backend failure must come back on the client's next
      // read — a reconnect's re-list, a watch-driven refresh, a folder expand — rather than on a
      // Refresh button. Arming an already-live root only bumps its recency. Its answer rides the
      // listing, so the tree learns it is no longer live from the very re-list a watcher failure
      // asks it for.
      const [listing, live] = await Promise.all([
        fileOps.listDirectory(fileOpsCtx, userId, sessionId, dirPath),
        fileWatchService.arm(userId, sessionId),
      ])
      return { ...listing, live }
    },

    async createFileEntry(
      userId: string,
      sessionId: string,
      parentPath: string,
      name: string,
      kind: 'file' | 'dir',
    ) {
      return fileOps.createEntry(fileOpsCtx, userId, sessionId, parentPath, name, kind)
    },

    async renameFileEntry(userId: string, sessionId: string, targetPath: string, newName: string) {
      return fileOps.renameEntry(fileOpsCtx, userId, sessionId, targetPath, newName)
    },

    async pasteFileEntry(
      userId: string,
      sessionId: string,
      source: string,
      destDir: string,
      mode: 'move' | 'copy',
    ) {
      return fileOps.pasteEntry(fileOpsCtx, userId, sessionId, source, destDir, mode)
    },

    async deleteFileEntry(
      userId: string,
      sessionId: string,
      targetPath: string,
      opts?: { permanent?: boolean },
    ) {
      return fileOps.deleteEntry(fileOpsCtx, userId, sessionId, targetPath, opts)
    },

    async duplicateFileEntry(userId: string, sessionId: string, targetPath: string) {
      return fileOps.duplicateEntry(fileOpsCtx, userId, sessionId, targetPath)
    },

    async undoFileOp(userId: string, sessionId: string) {
      return fileOps.undoLastFileOp(fileOpsCtx, userId, sessionId)
    },

    async revealFileEntry(userId: string, sessionId: string, targetPath: string) {
      return fileOps.revealEntry(fileOpsCtx, userId, sessionId, targetPath)
    },

    async findFiles(
      userId: string,
      sessionId: string,
      query: string,
      opts?: fileOps.FindFilesOptions,
    ) {
      return fileOps.findFiles(fileOpsCtx, userId, sessionId, query, opts)
    },

    async searchContent(
      userId: string,
      sessionId: string,
      query: string,
      opts?: fileOps.ContentSearchOptions,
    ) {
      return fileOps.searchContent(fileOpsCtx, userId, sessionId, query, opts)
    },

    async replaceContent(
      userId: string,
      sessionId: string,
      query: string,
      replacement: string,
      opts?: fileOps.ContentSearchOptions,
    ) {
      return fileOps.replaceContent(fileOpsCtx, userId, sessionId, query, replacement, opts)
    },
  }
}
