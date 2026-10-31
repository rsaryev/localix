/**
 * @localixai/engine — Localix's agent engine: `createEngine()` composes the loop
 * (`@localixai/engine-loop`), model access (`@localixai/engine-models`) and the script sandbox
 * behind the `AgentEngine` port. The host names this package in one place, its composition root,
 * which also takes its long-lived script VMs from here (the mods host runs each mod in one).
 */
export { createEngine, type EngineOptions } from './engine'
export { bundledScriptSandboxOptions, createScriptVms } from '@localixai/engine-scripts'
