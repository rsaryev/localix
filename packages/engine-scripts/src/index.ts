/**
 * @localixai/engine-scripts — JavaScript in QuickJS VMs, each in a worker thread, with a real
 * memory limit and an interrupt. The engine's `scripts` port (`sandbox.ts`): model-written code in
 * a fresh VM per script whose only capability is calling the tools it is handed. And long-lived
 * VMs (`vm.ts`): a runtime the host hands in, exchanging JSON text with the host until stopped.
 */
export { SCRIPT_WASM_FILE, SCRIPT_WORKER_FILE } from './assets'
export { renderDeclarations, schemaToType, toIdentifier } from './declarations'
export {
  MAX_CALL_ARGS_CHARS,
  MAX_CALLS,
  MAX_CONCURRENT_CALLS,
  MAX_OUTPUT_CHARS,
  MAX_OUTPUT_ITEMS,
  MAX_TOTAL_CALL_ARGS_CHARS,
} from './limits'
export { bundledScriptSandboxOptions, type ScriptSandboxOptions } from './runtime-files'
export { createScriptSandbox } from './sandbox'
export { createScriptVms, type ScriptVm, type ScriptVms, type ScriptVmStart } from './vm'
