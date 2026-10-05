/**
 * The session workspace's FILE surface — read/write a file, mutate the tree
 * (create/rename/paste/delete/duplicate/undo/reveal), and search it by name or
 * content. One of the `backendClient` domain modules spread into the facade in
 * `./client`, so `backendClient.getFileContent(...)` keeps working unchanged.
 */

import { client, unwrap } from './internal'
import { recoverRead } from './readRecovery'
import type {
  DirListing,
  FileContentResponse,
  FileContentSearchResult,
  FileDeleteResponse,
  FileEntryResponse,
  FileSearchMode,
  FileSearchResult,
  FileSearchType,
  FileUndoResponse,
  FileWriteResponse,
} from './contracts'

export const filesApi = {
  async getFileContent(
    sessionId: string,
    path: string,
    opts?: { full?: boolean; knownHash?: string; signal?: AbortSignal; onRecovery?: () => void },
  ): Promise<FileContentResponse> {
    return recoverRead(
      async () =>
        unwrap(
          await client.rpc.sessions[':id'].file.$get(
            {
              param: { id: sessionId },
              query: {
                path,
                ...(opts?.full ? { full: '1' as const } : {}),
                // Conditional read — the server answers `{ unchanged: true }` with an
                // empty body when this hash still matches disk, so a reconcile that
                // finds nothing changed costs a token instead of the whole file.
                ...(opts?.knownHash ? { knownHash: opts.knownHash } : {}),
              },
            },
            { init: { signal: opts?.signal } },
          ),
        ),
      { signal: opts?.signal, onRecovery: opts?.onRecovery },
    )
  },

  async writeFileContent(
    sessionId: string,
    path: string,
    content: string,
    baseHash: string,
  ): Promise<FileWriteResponse> {
    return unwrap(
      await client.rpc.sessions[':id'].file.$put({
        param: { id: sessionId },
        json: { path, content, baseHash },
      }),
    )
  },

  async listDirectory(sessionId: string, path?: string): Promise<DirListing> {
    return recoverRead(async () =>
      unwrap(
        await client.rpc.sessions[':id'].tree.$get({
          param: { id: sessionId },
          query: path ? { path } : {},
        }),
      ),
    )
  },

  /** Create a new empty file or folder under `parentPath` (a single name segment). */
  async createFileEntry(
    sessionId: string,
    parentPath: string,
    name: string,
    kind: 'file' | 'dir',
  ): Promise<FileEntryResponse> {
    return unwrap(
      await client.rpc.sessions[':id']['file-create'].$post({
        param: { id: sessionId },
        json: { parentPath, name, kind },
      }),
    )
  },

  /** Rename a tree entry in place (new name is a single segment). */
  async renameFileEntry(
    sessionId: string,
    path: string,
    newName: string,
  ): Promise<FileEntryResponse> {
    return unwrap(
      await client.rpc.sessions[':id']['file-rename'].$post({
        param: { id: sessionId },
        json: { path, newName },
      }),
    )
  },

  /** Move ('move') or duplicate ('copy') a tree entry into a destination folder. */
  async pasteFileEntry(
    sessionId: string,
    source: string,
    destDir: string,
    mode: 'move' | 'copy',
  ): Promise<FileEntryResponse> {
    return unwrap(
      await client.rpc.sessions[':id']['file-paste'].$post({
        param: { id: sessionId },
        json: { source, destDir, mode },
      }),
    )
  },

  /** Delete a tree entry. Local sessions move it to the trash (reversible via
   *  {@link undoFileOp}); `permanent` (or a remote backend) removes it for good. */
  async deleteFileEntry(
    sessionId: string,
    path: string,
    opts?: { permanent?: boolean },
  ): Promise<FileDeleteResponse> {
    return unwrap(
      await client.rpc.sessions[':id']['file-delete'].$post({
        param: { id: sessionId },
        json: { path, permanent: opts?.permanent },
      }),
    )
  },

  /** Duplicate a tree entry in place (copy into its own folder, name auto-incremented). */
  async duplicateFileEntry(sessionId: string, path: string): Promise<FileEntryResponse> {
    return unwrap(
      await client.rpc.sessions[':id']['file-duplicate'].$post({
        param: { id: sessionId },
        json: { path },
      }),
    )
  },

  /** Reverse the most recent reversible file-tree op (restore-from-trash / move-back / rename-back). */
  async undoFileOp(sessionId: string): Promise<FileUndoResponse> {
    return unwrap(await client.rpc.sessions[':id']['file-undo'].$post({ param: { id: sessionId } }))
  },

  /** Reveal a tree entry in the host OS file manager (local sessions only). */
  async revealFileEntry(sessionId: string, path: string): Promise<{ opened: true }> {
    return unwrap(
      await client.rpc.sessions[':id']['file-reveal'].$post({
        param: { id: sessionId },
        json: { path },
      }),
    )
  },

  /**
   * Project file search — backs the ⌘P quick-open palette, the composer
   * @-autocomplete, and the file-tree search box. Server-side filter + rank;
   * options select fuzzy/regex mode, files/folders, extension filter, and a page.
   */
  async searchFiles(
    sessionId: string,
    q: string,
    opts?: {
      limit?: number
      offset?: number
      mode?: FileSearchMode
      type?: FileSearchType
      /** Extensions without the dot, e.g. ['ts', 'tsx']. */
      extensions?: string[]
      /** Surface files a parent repo's .gitignore hides (container-of-clones). */
      includeIgnored?: boolean
    },
  ): Promise<FileSearchResult> {
    return unwrap(
      await client.rpc.sessions[':id'].files.$get({
        param: { id: sessionId },
        query: {
          ...(q ? { q } : {}),
          ...(opts?.limit ? { limit: String(opts.limit) } : {}),
          ...(opts?.offset ? { offset: String(opts.offset) } : {}),
          ...(opts?.mode ? { mode: opts.mode } : {}),
          ...(opts?.type ? { type: opts.type } : {}),
          ...(opts?.extensions && opts.extensions.length > 0
            ? { ext: opts.extensions.join(',') }
            : {}),
          ...(opts?.includeIgnored ? { includeIgnored: 'true' } : {}),
        },
      }),
    )
  },

  /**
   * Project content (text) search — greps file CONTENTS via ripgrep (backs the
   * inspector search panel's "Text" mode). Literal/smart-case by default so a
   * query like `const a` matches the substring verbatim.
   */
  async searchContent(
    sessionId: string,
    q: string,
    opts?: {
      limit?: number
      regex?: boolean
      caseSensitive?: boolean
      wholeWord?: boolean
      glob?: string
      excludeGlob?: string
      contextLines?: number
      /** Search inside files a parent repo's .gitignore hides (container-of-clones). */
      includeIgnored?: boolean
    },
  ): Promise<FileContentSearchResult> {
    return unwrap(
      await client.rpc.sessions[':id']['search-content'].$get({
        param: { id: sessionId },
        query: {
          ...(q ? { q } : {}),
          ...(opts?.limit ? { limit: String(opts.limit) } : {}),
          ...(opts?.regex ? { regex: 'true' } : {}),
          ...(opts?.caseSensitive ? { caseSensitive: 'true' } : {}),
          ...(opts?.wholeWord ? { wholeWord: 'true' } : {}),
          ...(opts?.glob ? { glob: opts.glob } : {}),
          ...(opts?.excludeGlob ? { excludeGlob: opts.excludeGlob } : {}),
          ...(opts?.contextLines ? { contextLines: String(opts.contextLines) } : {}),
          ...(opts?.includeIgnored ? { includeIgnored: 'true' } : {}),
        },
      }),
    )
  },

  /**
   * Search-and-replace across the project (Search view "Replace all"). Rewrites
   * every matching file through the locked write path; returns the totals.
   */
  async replaceContent(
    sessionId: string,
    q: string,
    replacement: string,
    opts?: {
      regex?: boolean
      caseSensitive?: boolean
      wholeWord?: boolean
      glob?: string
      excludeGlob?: string
      /** Replace inside files a parent repo's .gitignore hides, matching search. */
      includeIgnored?: boolean
    },
  ): Promise<{ filesChanged: number; replacements: number }> {
    return unwrap(
      await client.rpc.sessions[':id']['replace-content'].$post({
        param: { id: sessionId },
        json: {
          q,
          replacement,
          ...(opts?.regex ? { regex: true } : {}),
          ...(opts?.caseSensitive ? { caseSensitive: true } : {}),
          ...(opts?.wholeWord ? { wholeWord: true } : {}),
          ...(opts?.glob ? { glob: opts.glob } : {}),
          ...(opts?.excludeGlob ? { excludeGlob: opts.excludeGlob } : {}),
          ...(opts?.includeIgnored ? { includeIgnored: true } : {}),
        },
      }),
    )
  },
}
