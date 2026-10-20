import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CodemodeSandbox,
  loadQuickJSWasm,
  renderDeclarations,
  type CodemodeResult,
  type CodemodeTool,
} from '@earendil-works/pi-codemode'

import type {
  ScriptRunRequest,
  ScriptRunResult,
  ScriptSandbox,
  ScriptTool,
} from '@localixai/agent/runtime'

import { SCRIPT_WASM_FILE, SCRIPT_WORKER_FILE } from './script-assets'

export interface PiScriptSandboxOptions {
  /**
   * `quickjs-wasi/quickjs.wasm` on disk. Default: the installed package's file; pass it when the
   * host is bundled and the package is not beside it (the desktop sidecar's resources).
   */
  wasmPath?: string
  /**
   * The worker entry, a module that imports `@earendil-works/pi-codemode/worker`. Default: the
   * package's own worker; pass it for a bundled host, where that file is not on disk either.
   */
  workerUrl?: string | URL
}

/**
 * Where a BUNDLED host keeps the sandbox's worker and VM: both files in `dir`, the directory of the
 * running bundle. Undefined when they are not there — a host running from source, where the
 * installed package's own files are the default and nothing needs to be passed.
 */
export function bundledScriptSandboxOptions(dir: string): PiScriptSandboxOptions | undefined {
  const workerPath = join(dir, SCRIPT_WORKER_FILE)
  const wasmPath = join(dir, SCRIPT_WASM_FILE)
  if (!existsSync(workerPath) || !existsSync(wasmPath)) return undefined
  return { workerUrl: pathToFileURL(workerPath), wasmPath }
}

/** Every call resolves to the tool's text result, as in pi's codemode example. */
const TEXT_RESULT = { type: 'string' }

/**
 * The engine's `scripts` port on pi's codemode sandbox: a QuickJS VM in a worker thread per script,
 * closed when it settles, so nothing a script does outlives it.
 */
export function createPiScriptSandbox(options: PiScriptSandboxOptions = {}): ScriptSandbox {
  return {
    async run(request: ScriptRunRequest): Promise<ScriptRunResult> {
      const sandbox = new CodemodeSandbox({
        tools: request.tools.map(toCodemodeTool),
        timeoutMs: request.timeoutMs,
        ...(options.wasmPath ? { wasm: loadQuickJSWasm(options.wasmPath) } : {}),
        ...(options.workerUrl ? { workerUrl: options.workerUrl } : {}),
      })
      try {
        return fromCodemodeResult(
          await sandbox.execute(request.code, request.signal ? { signal: request.signal } : {}),
        )
      } finally {
        await sandbox.close()
      }
    },
    declare: (tools) =>
      renderDeclarations({
        tools: tools.map((tool) => ({
          ...tool,
          outputSchema: TEXT_RESULT,
          execute: () => Promise.reject(new Error(`${tool.name} is a declaration, not a call`)),
        })),
      }),
  }
}

function toCodemodeTool(tool: ScriptTool): CodemodeTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: TEXT_RESULT,
    execute: (input, { signal }) => tool.execute(input, signal),
  }
}

function fromCodemodeResult(result: CodemodeResult): ScriptRunResult {
  const output = result.output.map((item) =>
    item.type === 'text' ? { type: 'text' as const, text: item.text } : item,
  )
  if (result.ok) return { ok: true, value: result.value, output }
  const { message, stack } = result.error
  return { ok: false, error: { message, ...(stack ? { stack } : {}) }, output }
}
