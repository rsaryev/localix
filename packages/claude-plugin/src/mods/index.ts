/**
 * Claude Code mods without a host: the hook chain a hooks module registers into
 * (`engine.ts`), the matchers that pick hooks (`matcher.ts`) and the elements a mod draws with
 * (`elements.ts`). A host supplies the mods API and fires the events.
 */
export {
  createModsEngine,
  freezeDeep,
  ModLoadError,
  type DispatchOptions,
  type Hook,
  type HookFailure,
  type HookOrigin,
  type ModsApi,
  type ModsEngine,
  type ModsEngineOptions,
  type Next,
  type On,
  type RegisterFunction,
  type Registration,
} from './engine'
export { matchesEvent, matchesEventName, type Matcher, type MatcherValue } from './matcher'
export {
  ELEMENT_NAMES,
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
} from './elements'
