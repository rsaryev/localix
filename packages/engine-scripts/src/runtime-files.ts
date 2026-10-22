/**
 * Where a VM's files come from — the worker entry, `quickjs.wasm` and the extensions — and their
 * compiled modules, compiled once per path and shared by every VM of the process (a structured
 * clone hands a worker the compiled code, not a copy to compile again).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { SCRIPT_EXTENSION_FILES, SCRIPT_WASM_FILE, SCRIPT_WORKER_FILE } from './assets'

export interface ScriptSandboxOptions {
  /** `quickjs.wasm` on disk. Default: the installed `quickjs-wasi` package's file. */
  wasmPath?: string
  /** The worker entry. Default: this package's own; a bundled host passes its bundled copy. */
  workerUrl?: string | URL
  /** Where a long-lived VM's extensions are (`SCRIPT_EXTENSION_FILES`). Default: the package's. */
  extensionDir?: string
  /** The VM's heap; an allocation past it fails in the script as `InternalError: out of memory`. */
  memoryLimitBytes?: number
}

export type ExtensionName = keyof typeof SCRIPT_EXTENSION_FILES

export const DEFAULT_MEMORY_LIMIT = 256 * 1024 * 1024

/**
 * Where a BUNDLED host keeps the worker and the VM: both beside its bundle in `dir`, with the
 * extensions when they are there too. Undefined when they are not — a host running from source,
 * where the defaults already resolve.
 */
export function bundledScriptSandboxOptions(dir: string): ScriptSandboxOptions | undefined {
  const workerPath = join(dir, SCRIPT_WORKER_FILE)
  const wasmPath = join(dir, SCRIPT_WASM_FILE)
  if (!existsSync(workerPath) || !existsSync(wasmPath)) return undefined
  const extensions = Object.values(SCRIPT_EXTENSION_FILES).every((file) =>
    existsSync(join(dir, file)),
  )
  return {
    workerUrl: pathToFileURL(workerPath),
    wasmPath,
    ...(extensions ? { extensionDir: dir } : {}),
  }
}

const compiled = new Map<string, Promise<object>>()

/** Compiled once per path; a failed load is tried again by the next VM. */
export function loadWasm(path: string): Promise<object> {
  let module = compiled.get(path)
  if (!module) {
    module = readFile(path).then((bytes) => WebAssembly.compile(bytes))
    module.catch(() => compiled.delete(path))
    compiled.set(path, module)
  }
  return module
}

function defaultWorkerUrl(): URL {
  // `.ts` from source (tests, the dev server), `.js` from `dist`.
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)
}

const resolveInPackage = (specifier: string) => createRequire(import.meta.url).resolve(specifier)

/**
 * The files `options` names, resolved when a VM starts rather than when the sandbox is made: a
 * host missing them fails its scripts, not its boot. Throws when one cannot be found.
 */
export function resolveFiles(options: ScriptSandboxOptions) {
  return {
    wasm: options.wasmPath ?? resolveInPackage('quickjs-wasi/quickjs.wasm'),
    worker: options.workerUrl ?? defaultWorkerUrl(),
    extension: (name: ExtensionName) =>
      options.extensionDir === undefined
        ? resolveInPackage(`quickjs-wasi/${name}.so`)
        : join(options.extensionDir, SCRIPT_EXTENSION_FILES[name]),
  }
}

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
