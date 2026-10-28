import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import {
  fileExists,
  findUpward,
  managedNpmBin,
  resolveNpmBin,
  spawnServer,
  spawnJsServer,
  which,
} from './lsp-bin-resolve'
import { installedExecutable } from './lsp-installer'
import { isDockerfileName } from './lsp-languages'
import { createManagedJsServer } from './lsp-managed-js-server'
import { matchingLspServers } from './lsp-server-match'

export interface LspServerHandle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, unknown>
  /** The server's configuration, when it differs from `initialization` (a plugin's `settings`). */
  settings?: Record<string, unknown>
  /** How long `initialize` may take (a plugin's `startupTimeout`). */
  initializeTimeoutMs?: number
  /** How long any other request may take before it fails. */
  requestTimeoutMs?: number
  /** How long a graceful `shutdown` may take before the process is ended. */
  shutdownTimeoutMs?: number
  /** The language id a file opens with, when the server declares its own. */
  languageIdFor?: (filePath: string) => string | undefined
}

export interface LspServerDef {
  id: string
  extensions: string[]
  /** Optional filename match for extension-less files (e.g. `Dockerfile`). */
  matchesFilename?(base: string): boolean
  /** Return the root directory for this file, or undefined if the server should not handle it */
  resolveRoot(filePath: string, projectRoot: string): string | undefined
  /**
   * The package (`language-servers.json`) Localix installs when `spawn` finds nothing to run.
   * `spawn` then receives that install's folder as `installed`.
   */
  install?: string
  spawn(
    rootDir: string,
    projectRoot: string,
    installed?: string,
  ): Promise<LspServerHandle | undefined>
  /** `false`: its diagnostics are not reported after an edit (a plugin's `diagnostics: false`). */
  reportsDiagnostics?: false
}

export const VTSLS_MAX_TS_SERVER_MEMORY_MB = 1536

export function resolveTypeScriptRoot(filePath: string, projectRoot: string): string | undefined {
  const dir = path.dirname(filePath)
  if (findUpward(dir, projectRoot, ['deno.json', 'deno.jsonc'])) return undefined
  const workspaceRoot = findUpward(dir, projectRoot, [
    'package-lock.json',
    'bun.lockb',
    'bun.lock',
    'pnpm-lock.yaml',
    'yarn.lock',
  ])
  return workspaceRoot ?? findUpward(dir, projectRoot, ['package.json']) ?? projectRoot
}

export function typescriptInitialization(tsdk?: string): Record<string, unknown> {
  return {
    typescript: {
      ...(tsdk ? { tsdk } : {}),
      tsserver: { maxTsServerMemory: VTSLS_MAX_TS_SERVER_MEMORY_MB },
    },
  }
}

export const TypescriptServer: LspServerDef = {
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  resolveRoot(filePath, projectRoot) {
    return resolveTypeScriptRoot(filePath, projectRoot)
  },
  install: 'typescript',
  async spawn(rootDir, projectRoot, installed) {
    // vtsls (`@vtsls/language-server`, installed on first use), run via the API's own runtime
    // (Bun) so TypeScript intelligence needs NO Node.js install. We tried
    // typescript-language-server but it does not run cleanly under Bun; vtsls
    // does (verified: real diagnostics, hover, completion).
    const bin = resolveNpmBin('vtsls', rootDir, projectRoot, installed)
    if (!bin) return undefined

    // Prefer the project's TypeScript (`tsdk`, the `typescript/lib` dir that holds a
    // `tsserver.js`); without one vtsls uses the TypeScript it depends on.
    const tsserver = [rootDir, projectRoot]
      .map((dir) => path.join(dir, 'node_modules', 'typescript', 'lib', 'tsserver.js'))
      .find(fileExists)
    const tsdk = tsserver ? path.dirname(tsserver) : undefined

    const proc = spawnJsServer(bin, ['--stdio'], rootDir)
    if (!proc) return undefined

    return {
      process: proc,
      initialization: typescriptInitialization(tsdk),
    }
  },
}

export const DenoServer: LspServerDef = {
  id: 'deno',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
  resolveRoot(filePath, projectRoot) {
    return findUpward(path.dirname(filePath), projectRoot, ['deno.json', 'deno.jsonc'])
  },
  async spawn(rootDir) {
    const bin = which('deno')
    if (!bin) return undefined
    const proc = spawnServer(bin, ['lsp'], rootDir)
    if (!proc) return undefined
    return { process: proc }
  },
}

export const VueServer: LspServerDef = {
  id: 'vue',
  extensions: ['.vue'],
  resolveRoot(filePath, projectRoot) {
    const lockfiles = [
      'package.json',
      'package-lock.json',
      'bun.lockb',
      'bun.lock',
      'pnpm-lock.yaml',
      'yarn.lock',
    ]
    return findUpward(path.dirname(filePath), projectRoot, lockfiles) ?? projectRoot
  },
  async spawn(rootDir, projectRoot) {
    const bin = resolveNpmBin('vue-language-server', rootDir, projectRoot)
    if (!bin) return undefined
    const proc = spawnJsServer(bin, ['--stdio'], rootDir)
    if (!proc) return undefined
    return { process: proc, initialization: {} }
  },
}

export const PythonServer: LspServerDef = {
  id: 'python',
  extensions: ['.py'],
  resolveRoot(filePath, projectRoot) {
    const dir = path.dirname(filePath)
    return findUpward(dir, projectRoot, ['pyproject.toml', 'setup.py', 'setup.cfg']) ?? projectRoot
  },
  install: 'pyright',
  async spawn(rootDir, _projectRoot, installed) {
    const pylsp = which('pylsp')
    if (pylsp) {
      const proc = spawnServer(pylsp, [], rootDir)
      return proc ? { process: proc } : undefined
    }
    // Pyright is an npm package: run with Bun wherever it was found, so it never needs Node.
    const pyright =
      which('pyright-langserver') ??
      (installed ? managedNpmBin(installed, 'pyright-langserver') : undefined)
    if (!pyright) return undefined
    const proc = spawnJsServer(pyright, ['--stdio'], rootDir)
    return proc ? { process: proc } : undefined
  },
}

export const GoServer: LspServerDef = {
  id: 'go',
  extensions: ['.go'],
  resolveRoot(filePath, projectRoot) {
    const dir = path.dirname(filePath)
    return findUpward(dir, projectRoot, ['go.mod']) ?? projectRoot
  },
  install: 'gopls',
  async spawn(rootDir, _projectRoot, installed) {
    const bin =
      which('gopls') ?? (installed ? installedExecutable('golang', 'gopls', installed) : undefined)
    if (!bin) return undefined
    const proc = spawnServer(bin, ['serve'], rootDir)
    if (!proc) return undefined
    return { process: proc }
  },
}

export const RustServer: LspServerDef = {
  id: 'rust',
  extensions: ['.rs'],
  resolveRoot(filePath, projectRoot) {
    const dir = path.dirname(filePath)
    return findUpward(dir, projectRoot, ['Cargo.toml']) ?? projectRoot
  },
  install: 'rust-analyzer',
  async spawn(rootDir, _projectRoot, installed) {
    const bin =
      which('rust-analyzer') ??
      (installed ? installedExecutable('github', 'rust-analyzer', installed) : undefined)
    if (!bin) return undefined
    const proc = spawnServer(bin, [], rootDir)
    if (!proc) return undefined
    return { process: proc }
  },
}

/** HTML language server (vscode-html-language-server, from vscode-langservers-extracted). */
export const HtmlServer: LspServerDef = createManagedJsServer({
  id: 'html',
  extensions: ['.html', '.htm'],
  binName: 'vscode-html-language-server',
  install: 'vscode-langservers',
})

/**
 * JSON language server (vscode-json-language-server, from vscode-langservers-extracted).
 * Reports syntax diagnostics out of the box (e.g. "Trailing comma" json(519)) with no schema
 * config needed.
 */
export const JsonServer: LspServerDef = createManagedJsServer({
  id: 'json',
  extensions: ['.json', '.jsonc'],
  binName: 'vscode-json-language-server',
  install: 'vscode-langservers',
})

/**
 * CSS/SCSS/Less language server (vscode-css-language-server, same package).
 * Reports stylesheet syntax + unknown-property diagnostics.
 */
export const CssServer: LspServerDef = createManagedJsServer({
  id: 'css',
  extensions: ['.css', '.scss', '.less'],
  binName: 'vscode-css-language-server',
  install: 'vscode-langservers',
})

/**
 * Dockerfile language server (dockerfile-language-server-nodejs). Emits
 * `dockerfile-utils` diagnostics (e.g. "Unknown instruction" / "No source image
 * provided with FROM"). Detected by FILENAME — Dockerfiles have no extension.
 */
export const DockerServer: LspServerDef = createManagedJsServer({
  id: 'dockerfile',
  extensions: ['.dockerfile'],
  matchesFilename: isDockerfileName,
  binName: 'docker-langserver',
  install: 'dockerfile',
})

/** YAML language server (yaml-language-server). Syntax + schema diagnostics for `.yaml`/`.yml`. */
export const YamlServer: LspServerDef = createManagedJsServer({
  id: 'yaml',
  extensions: ['.yaml', '.yml'],
  binName: 'yaml-language-server',
  install: 'yaml',
})

export const ALL_SERVERS: LspServerDef[] = [
  DenoServer,
  TypescriptServer,
  VueServer,
  PythonServer,
  GoServer,
  RustServer,
  HtmlServer,
  JsonServer,
  CssServer,
  DockerServer,
  YamlServer,
]

export function getServersForExtension(ext: string): LspServerDef[] {
  return ALL_SERVERS.filter((s) => s.extensions.includes(ext))
}

/** Servers that handle a file — by extension OR by a filename match (Dockerfile). */
export function getServersForFile(filePath: string): LspServerDef[] {
  return matchingLspServers(ALL_SERVERS, filePath)
}
