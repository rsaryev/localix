import { resolveNpmBin, spawnJsServer, which } from './lsp-bin-resolve'
import type { LspServerDef } from './lsp-servers'

interface BundledServerOptions {
  id: string
  extensions: string[]
  binName: string
  matchesFilename?: LspServerDef['matchesFilename']
}

/** JavaScript servers with project-local lookup, PATH fallback and no extra initialization. */
export function createBundledJsServer({
  id,
  extensions,
  binName,
  matchesFilename,
}: BundledServerOptions): LspServerDef {
  return {
    id,
    extensions,
    ...(matchesFilename ? { matchesFilename } : {}),
    resolveRoot(_filePath, projectRoot) {
      return projectRoot
    },
    async spawn(rootDir, projectRoot) {
      const bin =
        resolveNpmBin(binName, rootDir) ?? resolveNpmBin(binName, projectRoot) ?? which(binName)
      if (!bin) return undefined
      const proc = spawnJsServer(bin, ['--stdio'], rootDir)
      if (!proc) return undefined
      return { process: proc, initialization: {} }
    },
  }
}
