import type { Effect } from '../agent-core/capability-rule'
import type { RESOURCE_CLASSES } from '../agent-core/capability-resource-classes'

/**
 * WHAT AN ARTIFACT IS, so a rule can say something about it.
 *
 * A trust class is not a decision. It is a FACT about the artifact, carried into the rule's
 * `resource` slot exactly like `dangerous` is carried for a shell command — so
 * `plugin:* untrusted ask` is an ordinary row a person can read, write and delete, and
 * `plugin:office * allow` is the ordinary row that answers over it.
 *
 * `untrusted` is the hard boundary: a folder that appeared in `~/.localix/plugins` or
 * `~/.localix/mini-apps` is not a decision anybody made, whether or not it carries code, so every
 * plugin and mini app is `untrusted` (Localix ships none: X5). `bundled` is what ships with the
 * application, today the agent types; `opt-in` is kept for rules written when a shipped plugin
 * could ask before running.
 */
export type TrustClass = Extract<
  (typeof RESOURCE_CLASSES)[number]['value'],
  'bundled' | 'opt-in' | 'untrusted'
>

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
