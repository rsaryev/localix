import type { Effect } from '../capabilities/rule'
import type { RESOURCE_CLASSES } from '../capabilities/resource-classes'

/**
 * WHAT AN ARTIFACT IS, so a rule can say something about it.
 *
 * This replaced `resolveEnabledByDefault` — a decision table that answered "is this on when
 * nobody has decided". That question had two owners pulling in opposite directions: the
 * matrix knew about bundling and third-party code, and the rules knew what the user wanted,
 * and the only way to combine them was a three-valued `decided()` feeding a `??`.
 *
 * A trust class is not a decision. It is a FACT about the artifact, carried into the rule's
 * `resource` slot exactly like `dangerous` is carried for a shell command — so
 * `plugin:* untrusted ask` is an ordinary row a person can read, write and delete, and
 * `plugin:office * allow` is the ordinary row that answers over it.
 */
export type TrustClass = Extract<
  (typeof RESOURCE_CLASSES)[number]['value'],
  'bundled' | 'opt-in' | 'untrusted'
>

export interface TrustFacts {
  /** True when the artifact ships with the application. */
  isBundled: boolean
  /** True when enabling it would import code into this process. */
  isCodeBearing: boolean
  /** The manifest's own `defaultEnabled`, when it states one. */
  defaultEnabled: boolean | undefined
}

/**
 * The class an artifact belongs to.
 *
 * `untrusted` is the hard boundary and it is the bundle boundary: a folder that appeared in
 * `~/.localix/plugins` is not a decision anybody made, whether or not it carries code.
 *
 * `opt-in` is ours but asks anyway — a bundled plugin that imports code and does not claim
 * `defaultEnabled`. It is a separate class rather than the same one because the question a
 * person should be asked differs: "this ships with Localix but is off by default" is not
 * "this came from somewhere else".
 */
export function trustClassOf(facts: TrustFacts): TrustClass {
  if (!facts.isBundled) return 'untrusted'
  if (facts.isCodeBearing && facts.defaultEnabled !== true) return 'opt-in'
  return facts.defaultEnabled === false ? 'opt-in' : 'bundled'
}

/**
 * What the class means when NO rule mentions the artifact.
 *
 * The one place a fallback varies, and it varies by the artifact rather than by its kind —
 * which is the whole reason the per-kind `DEFAULT_EFFECT` table could not express it: a
 * bundled plugin and a dropped-in one are the same kind and deserve opposite answers.
 *
 * `ask` rather than `deny` for the two that are not plain-bundled: the user installed the
 * thing, so the honest default is to put the question to them rather than to fail silently,
 * which is what an unexplained "off" had been doing.
 */
export const trustFallback = (trust: TrustClass): Effect => (trust === 'bundled' ? 'allow' : 'ask')
