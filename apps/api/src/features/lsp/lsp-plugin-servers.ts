import { managedNpmBin, spawnJsServer, spawnServer, which } from './lsp-bin-resolve'
import { commandInstall } from './lsp-command-installs'
import type { LspServerDef } from './lsp-servers'
import type { PluginLspServer } from '../plugins/kit'
import { isRecord } from '../../lib/record'

/**
 * A plugin's language server (Claude Code `lspServers` / `.lsp.json`) as Localix's LSP client runs
 * it. What the config means comes resolved from the plugin kit (`plugins/kit/lsp-servers.ts`):
 * the substituted command line and environment, the documented defaults, the language a file opens
 * with and whether a crashed server starts again. What stays here is the client's: finding the
 * binary (on PATH, else installed on first use when Localix knows it), the process, the root, and
 * the extensions the manager routes a file by (lowercase, as it reads a file's).
 */

/** The extensions a server is routed files by: lowercase, each once (`.C` beside `.c` is `.c`). */
export const routedExtensions = (extensions: readonly string[]): string[] => [
  ...new Set(extensions.map((extension) => extension.toLowerCase())),
]

/**
 * Build an {@link LspServerDef} from a plugin's resolved server. It handles `extensions` (all it
 * declares unless a caller narrowed them), roots at its `workspaceFolder` or the project root, and
 * spawns `command` over stdio with its environment. A server that exited on its own starts again
 * only while the kit says it restarts.
 */
export function configuredLspServer(
  server: PluginLspServer,
  extensions: readonly string[] = routedExtensions(server.extensions),
): LspServerDef {
  let crashes = 0
  // Not on PATH: installed on first use when Localix knows the command (`lsp-command-installs.ts`).
  const managed = commandInstall(server.command)
  const mayStart = () => crashes === 0 || server.restarts(crashes - 1)
  return {
    id: server.id,
    extensions: [...extensions],
    ...(server.diagnostics ? {} : { reportsDiagnostics: false }),
    resolveRoot(_filePath, projectRoot) {
      return server.workspaceFolder ?? projectRoot
    },
    ...(managed ? { install: managed.package } : {}),
    async spawn(rootDir, _projectRoot, installed) {
      if (!mayStart()) return undefined
      const args = [...server.args]
      const env = { ...server.env }
      const onPath = which(server.command)
      let proc
      if (managed?.npmBin) {
        // An npm server runs with Localix's own Bun wherever it was found: its
        // `#!/usr/bin/env node` would otherwise need a Node install.
        const bin = onPath ?? (installed ? managedNpmBin(installed, managed.npmBin) : undefined)
        if (!bin) return undefined
        proc = spawnJsServer(bin, args, rootDir, env)
      } else {
        const bin = onPath ?? (installed ? managed?.executable?.(installed) : undefined)
        if (!bin) return undefined
        proc = spawnServer(bin, args, rootDir, env)
      }
      if (!proc) return undefined
      // An exit with no signal is the server's own: a crash (`restartOnCrash` / `maxRestarts`).
      // Shutdown and idle eviction end it with a signal.
      proc.once('exit', (_code, signal) => {
        if (signal === null) crashes++
      })
      return {
        process: proc,
        initialization: objectOr(server.initializationOptions) ?? {},
        ...(objectOr(server.settings) ? { settings: objectOr(server.settings) } : {}),
        ...(server.startupTimeoutMs ? { initializeTimeoutMs: server.startupTimeoutMs } : {}),
        requestTimeoutMs: server.requestTimeoutMs,
        ...(server.shutdownTimeoutMs ? { shutdownTimeoutMs: server.shutdownTimeoutMs } : {}),
        languageIdFor: (filePath: string) => server.languageIdFor(filePath),
      }
    },
  }
}

/** The client sends an object for `initializationOptions` and `settings`. */
const objectOr = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined
