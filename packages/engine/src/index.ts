/**
 * @localixai/engine — Localix's agent engine: `createEngine()` composes the loop
 * (`@localixai/engine-loop`), model access (`@localixai/engine-models`) and the script sandbox
 * behind the `AgentEngine` port. The host names this package in one place, its composition root.
 */
export { createEngine, type EngineOptions } from './engine'
export {
  StreamIdleTimeoutError,
  PreflightRejection,
  LanguageModelCompletionError,
} from '@localixai/engine-models'
export { bundledScriptSandboxOptions } from '@localixai/engine-scripts'
