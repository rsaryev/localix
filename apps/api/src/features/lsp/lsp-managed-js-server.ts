import { resolveNpmBin, spawnJsServer } from './lsp-bin-resolve'
import type { LspServerDef } from './lsp-servers'

interface ManagedServerOptions {
  id: string
  extensions: string[]
  binName: string
  /** The npm package that provides `binName` (`language-servers.json`). */
  install: string
  matchesFilename?: LspServerDef['matchesFilename']
}

/** JavaScript servers Localix installs on first use, resolved install-first, with no extra init. */
export function createManagedJsServer({
  id,
  extensions,
  binName,
  install,
  matchesFilename,
}: ManagedServerOptions): LspServerDef {
  return {
    id,
    extensions,
    ...(matchesFilename ? { matchesFilename } : {}),
    resolveRoot(_filePath, projectRoot) {
      return projectRoot
    },
    install,
    async spawn(rootDir, projectRoot, installed) {
      const bin = resolveNpmBin(binName, rootDir, projectRoot, installed)
      if (!bin) return undefined
      const proc = spawnJsServer(bin, ['--stdio'], rootDir)
      if (!proc) return undefined
      return { process: proc, initialization: {} }
    },
  }
}
