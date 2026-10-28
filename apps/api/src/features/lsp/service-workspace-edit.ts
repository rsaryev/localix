import type { LspWorkspaceEditFile } from './lsp-response-types'
import type { OpenDoc } from './service-contract'
import type { RenameResult } from './service-result-types'
import { routeWorkspaceEdit } from './edit-routing'

interface WorkspaceEditPorts {
  getOpenDoc: (sessionId: string, file: string) => OpenDoc | undefined
  commitWorkspaceEdit: (
    userId: string,
    sessionId: string,
    fileEdits: LspWorkspaceEditFile[],
  ) => Promise<RenameResult>
}

/** Route edits against owned, synchronized buffers before committing the disk half. */
export function createWorkspaceEditApplicator({
  getOpenDoc,
  commitWorkspaceEdit,
}: WorkspaceEditPorts) {
  async function applyWorkspaceEdit(
    userId: string,
    sessionId: string,
    fileEdits: LspWorkspaceEditFile[],
  ): Promise<RenameResult> {
    const docs = new Map<string, OpenDoc>()
    for (const { file } of fileEdits) {
      const doc = getOpenDoc(sessionId, file)
      if (doc?.userId !== userId) continue
      // Every range is computed against the text the server holds once this settles.
      await doc.syncing.catch(() => {})
      docs.set(file, doc)
    }
    return routeWorkspaceEdit(
      fileEdits,
      (file) => docs.get(file)?.text,
      (diskEdits) => commitWorkspaceEdit(userId, sessionId, diskEdits),
    )
  }

  return applyWorkspaceEdit
}
