/**
 * @localixai/engine-scripts — JavaScript in QuickJS VMs, each in a worker thread, with a real
 * memory limit and an interrupt. The engine's `scripts` port (`sandbox.ts`): model-written code in
 * a fresh VM per script whose only capability is calling the tools it is handed. And long-lived
 * VMs (`vm.ts`): a runtime the host hands in, exchanging JSON text with the host until stopped.
 */
export { bundledScriptSandboxOptions, type ScriptSandboxOptions } from './runtime-files'
export { createScriptSandbox } from './sandbox'
export { createScriptVms, type ScriptVm, type ScriptVms, type ScriptVmStart } from './vm'
