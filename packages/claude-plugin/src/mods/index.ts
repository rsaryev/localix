/**
 * Claude Code mods without a host: the hook chain a hooks module registers into
 * (`engine.ts`), the matchers that pick hooks (`matcher.ts`) and the elements a mod draws with
 * (`elements.ts`). A host supplies the mods API and fires the events.
 */
export {
  createModsEngine,
  freezeDeep,
  type DispatchOptions,
  type Hook,
  type HookFailure,
  type HookOrigin,
  type HookStream,
  type ModsApi,
  type ModsEngine,
  type ModsEngineOptions,
  type Next,
  type On,
  type RegisterFunction,
  type Registration,
} from './engine'
export { COUNTED_CALLS, SYNC_CALLS } from './intercept'
export type { BudgetClock } from './budget'
export type { TraceEntry, TraceOutcome } from './trace'
export { matchesEvent, matchesEventName, type Matcher, type MatcherValue } from './matcher'
export { isHookBody } from './stream'
export { PLAIN_DATA_LIMITS, plainDataProblem } from './plain-data'
export {
  CLIENT_ELEMENT_NAMES,
  ELEMENT_NAMES,
  elementConstructor,
  elementNameOf,
  elementTable,
  Fragment,
  h,
  InvalidTreeError,
  serializeTree,
  type ElementHandlers,
  type ElementName,
  type ElementTable,
  type JsonElement,
  type RenderChild,
  type RenderElement,
  type SerializeOptions,
} from './elements'
