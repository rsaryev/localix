/**
 * `@localixai/oxlint-rules` — repository invariants that run INSIDE oxlint.
 *
 * The repository already enforces structure through standalone scripts under `scripts/`, and those
 * stay: a whole-tree contract ("every plugin manifest agrees with its directory") is not a thing a
 * per-node linter can express. What a script cannot do is point at the offending line while it is
 * being written. Rules here are the per-node half — reported at the exact node, in the editor, with
 * the fix available where one is safe.
 *
 * oxlint loads this file directly. There is no build step, because `jsPlugins` accepts TypeScript
 * and both Bun and Node ≥22 strip the types themselves; a compiled `dist/` would only add a way for
 * the linter to run against a stale copy of its own rules.
 */
import { noAdhocFocusRing } from './rules/no-adhoc-focus-ring.ts'
import { noGlobalKeyListener } from './rules/no-global-key-listener.ts'
import { noGroundTokenOnControl } from './rules/no-ground-token-on-control.ts'
import { noHardcodedColors } from './rules/no-hardcoded-colors.ts'
import { noOffScaleRadius } from './rules/no-off-scale-radius.ts'
import { propsTypeNaming } from './rules/props-type-naming.ts'
import type { Plugin, Rule } from './types.ts'

/** Rule name as written in `.oxlintrc.json` (`localix/<name>`) to its implementation. */
export const RULES: Readonly<Record<string, Rule>> = {
  'no-adhoc-focus-ring': noAdhocFocusRing,
  'no-global-key-listener': noGlobalKeyListener,
  'no-ground-token-on-control': noGroundTokenOnControl,
  'no-hardcoded-colors': noHardcodedColors,
  'no-off-scale-radius': noOffScaleRadius,
  'props-type-naming': propsTypeNaming,
}

const plugin: Plugin = {
  meta: { name: 'localix' },
  rules: RULES,
}

export default plugin
