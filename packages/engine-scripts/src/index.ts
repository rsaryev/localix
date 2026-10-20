/**
 * @localixai/engine-scripts — the engine's `scripts` port: model-written JavaScript in a QuickJS VM
 * (a fresh one per script, in a worker thread) whose only capability is calling the tools it is
 * handed.
 */
export { SCRIPT_WASM_FILE, SCRIPT_WORKER_ENTRY, SCRIPT_WORKER_FILE } from './assets'
export { renderDeclarations, schemaToType, toIdentifier } from './declarations'
export { MAX_OUTPUT_CHARS, MAX_OUTPUT_ITEMS } from './prelude'
export {
  bundledScriptSandboxOptions,
  createScriptSandbox,
  type ScriptSandboxOptions,
} from './sandbox'
