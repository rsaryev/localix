import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import {
  fileExists,
  findUpward,
  resolveNpmBin,
  resolveUpward,
  spawnServer,
  spawnJsServer,
  which,
} from './lsp-bin-resolve'
import { isDockerfileName } from './lsp-languages'

export interface LspServerHandle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, unknown>
}

export interface LspServerDef {
  id: string
  extensions: string[]
  /** Optional filename match for extension-less files (e.g. `Dockerfile`). */
  matchesFilename?(base: string): boolean
  /** Return the root directory for this file, or undefined if the server should not handle it */
  resolveRoot(filePath: string, projectRoot: string): string | undefined
  spawn(rootDir: string, projectRoot: string): Promise<LspServerHandle | undefined>
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
  async spawn(rootDir, projectRoot) {
    // vtsls (bundled `@vtsls/language-server`), run via the API's own runtime
    // (Bun) so TypeScript intelligence needs NO Node.js install. We tried
    // typescript-language-server but it does not run cleanly under Bun; vtsls
    // does (verified: real diagnostics, hover, completion).
    const bin = resolveNpmBin('vtsls', rootDir) ?? resolveNpmBin('vtsls', projectRoot)
    if (!bin) return undefined

    // vtsls needs a TypeScript install — point it at the `typescript/lib` dir
    // (`tsdk`). Resolve the project's TS first, then the monorepo's bundled one.
    const tsserver = (() => {
      const local = path.join(rootDir, 'node_modules', 'typescript', 'lib', 'tsserver.js')
      if (fileExists(local)) return local
      const projLocal = path.join(projectRoot, 'node_modules', 'typescript', 'lib', 'tsserver.js')
      if (fileExists(projLocal)) return projLocal
      return resolveUpward(
        path.join('node_modules', 'typescript', 'lib', 'tsserver.js'),
        import.meta.dir,
      )
    })()
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
    const bin =
      resolveNpmBin('vue-language-server', rootDir) ??
      resolveNpmBin('vue-language-server', projectRoot)
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
  async spawn(rootDir) {
    const bin = which('pylsp') ?? which('pyright-langserver')
    if (!bin) return undefined
    const args = bin.includes('pyright') ? ['--stdio'] : []
    const proc = spawnServer(bin, args, rootDir)
    if (!proc) return undefined
    return { process: proc }
  },
}

export const GoServer: LspServerDef = {
  id: 'go',
  extensions: ['.go'],
  resolveRoot(filePath, projectRoot) {
    const dir = path.dirname(filePath)
    return findUpward(dir, projectRoot, ['go.mod']) ?? projectRoot
  },
  async spawn(rootDir) {
    const bin = which('gopls')
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
  async spawn(rootDir) {
    const bin = which('rust-analyzer')
    if (!bin) return undefined
    const proc = spawnServer(bin, [], rootDir)
    if (!proc) return undefined
    return { process: proc }
  },
}

export const HtmlServer: LspServerDef = {
  id: 'html',
  extensions: ['.html', '.htm'],
  resolveRoot(_filePath, projectRoot) {
    return projectRoot
  },
  async spawn(rootDir, projectRoot) {
    const bin =
      resolveNpmBin('html-languageserver', rootDir) ??
      resolveNpmBin('html-languageserver', projectRoot) ??
      which('html-languageserver')
    if (!bin) return undefined
    const proc = spawnJsServer(bin, ['--stdio'], rootDir)
    if (!proc) return undefined
    return { process: proc, initialization: {} }
  },
}

/**
 * JSON language server (vscode-json-language-server, bundled via
 * vscode-langservers-extracted). Reports syntax diagnostics out of the box
 * (e.g. "Trailing comma" json(519)) with no schema config needed — this is why
 * `.json` files previously showed NO error squiggles: there was no server for
 * the extension at all. Resolved from the monorepo node_modules so it works
 * without the user installing anything.
 */
export const JsonServer: LspServerDef = {
  id: 'json',
  extensions: ['.json', '.jsonc'],
  resolveRoot(_filePath, projectRoot) {
    return projectRoot
  },
  async spawn(rootDir, projectRoot) {
    const bin =
      resolveNpmBin('vscode-json-language-server', rootDir) ??
      resolveNpmBin('vscode-json-language-server', projectRoot) ??
      which('vscode-json-language-server')
    if (!bin) return undefined
    const proc = spawnJsServer(bin, ['--stdio'], rootDir)
    if (!proc) return undefined
    return { process: proc, initialization: {} }
  },
}

/**
 * CSS/SCSS/Less language server (vscode-css-language-server, same bundle).
 * Reports stylesheet syntax + unknown-property diagnostics.
 */
export const CssServer: LspServerDef = {
  id: 'css',
  extensions: ['.css', '.scss', '.less'],
  resolveRoot(_filePath, projectRoot) {
    return projectRoot
  },
  async spawn(rootDir, projectRoot) {
    const bin =
      resolveNpmBin('vscode-css-language-server', rootDir) ??
      resolveNpmBin('vscode-css-language-server', projectRoot) ??
      which('vscode-css-language-server')
    if (!bin) return undefined
    const proc = spawnJsServer(bin, ['--stdio'], rootDir)
    if (!proc) return undefined
    return { process: proc, initialization: {} }
  },
}

/**
 * Dockerfile language server (dockerfile-language-server-nodejs, bundled). Emits
 * `dockerfile-utils` diagnostics (e.g. "Unknown instruction" / "No source image
 * provided with FROM"). Detected by FILENAME — Dockerfiles have no extension.
 */
export const DockerServer: LspServerDef = {
  id: 'dockerfile',
  extensions: ['.dockerfile'],
  matchesFilename: isDockerfileName,
  resolveRoot(_filePath, projectRoot) {
    return projectRoot
  },
  async spawn(rootDir, projectRoot) {
    const bin =
      resolveNpmBin('docker-langserver', rootDir) ??
      resolveNpmBin('docker-langserver', projectRoot) ??
      which('docker-langserver')
    if (!bin) return undefined
    const proc = spawnJsServer(bin, ['--stdio'], rootDir)
    if (!proc) return undefined
    return { process: proc, initialization: {} }
  },
}

/**
 * YAML language server (yaml-language-server, bundled). Syntax + schema
 * diagnostics for `.yaml`/`.yml`.
 */
export const YamlServer: LspServerDef = {
  id: 'yaml',
  extensions: ['.yaml', '.yml'],
  resolveRoot(_filePath, projectRoot) {
    return projectRoot
  },
  async spawn(rootDir, projectRoot) {
    const bin =
      resolveNpmBin('yaml-language-server', rootDir) ??
      resolveNpmBin('yaml-language-server', projectRoot) ??
      which('yaml-language-server')
    if (!bin) return undefined
    const proc = spawnJsServer(bin, ['--stdio'], rootDir)
    if (!proc) return undefined
    return { process: proc, initialization: {} }
  },
}

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
  const base = filePath.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : ''
  return ALL_SERVERS.filter((s) => (ext && s.extensions.includes(ext)) || s.matchesFilename?.(base))
}
