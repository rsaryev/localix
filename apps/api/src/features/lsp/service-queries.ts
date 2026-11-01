import type { LspManager } from './lsp-manager-types'
import type { LspDocumentService } from './service-contract'

interface QueryPorts {
  getManager: () => LspManager
  /** The project root for a file-scoped request, behind the buffer's own pending sync. */
  projectRootAfterSync: (userId: string, sessionId: string, file: string) => Promise<string>
}

/** The file-scoped editor requests that forward one query to the manager, unchanged. */
export function createServiceQueries({
  getManager,
  projectRootAfterSync,
}: QueryPorts): Pick<
  LspDocumentService,
  | 'hover'
  | 'completion'
  | 'signatureHelp'
  | 'inlayHint'
  | 'documentColor'
  | 'documentSymbols'
  | 'documentHighlight'
  | 'prepareRename'
  | 'codeAction'
> {
  return {
    async hover(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().hover(projectRoot, file, position)
    },

    async completion(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().completion(projectRoot, file, position)
    },

    async signatureHelp(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().signatureHelp(projectRoot, file, position)
    },

    async inlayHint(userId, sessionId, file, range) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().inlayHint(projectRoot, file, range)
    },

    async documentColor(userId, sessionId, file) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().documentColor(projectRoot, file)
    },

    async documentSymbols(userId, sessionId, file) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().documentSymbols(projectRoot, file)
    },

    async documentHighlight(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().documentHighlight(projectRoot, file, position)
    },

    async prepareRename(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().prepareRename(projectRoot, file, position)
    },

    async codeAction(userId, sessionId, file, range, kinds, trigger) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return getManager().codeAction(projectRoot, file, range, kinds, trigger)
    },
  }
}
