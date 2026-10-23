/**
 * Keyboard focus has ONE recipe.
 *
 * `focus-ring` (`packages/kit/styles/utilities.css`) is it: a 1px inset outline in
 * `--control-border-focus`, keyboard-only, and inset so it cannot be clipped by an
 * `overflow-hidden` strip. It weighs exactly what a control's own hairline weighs — 2px of `--ring`
 * was tried first and read as a collar, since `--ring` is monochrome by design. A hand-rolled
 * `focus-visible:ring-*` is a SECOND focus language, and once there are two there are five — an
 * audit of this repo found `ring-ring/40`, `ring-ring` at two widths, `ring-control-border-focus`,
 * a status colour used as focus in six task-board files, and a `focus:` (not `focus-visible:`) ring
 * that lit up on mouse clicks. Focus is the one affordance a keyboard user navigates by; it cannot
 * look different in every corner of the app.
 *
 * Reported: a `ring` utility behind a `focus-visible:` or `focus:` variant, written by hand.
 *
 * NOT reported, because each is the recipe rather than a deviation from it:
 *   - the four files listed below, which SPELL the recipe out — those ARE the contract that
 *     `focus-ring` mirrors, and a control built on them inherits it. Every other primitive
 *     (`input.tsx`, `textarea.tsx`, `checkbox.tsx`, `choice-trigger.ts`) interpolates
 *     `CONTROL_FOCUS_VISIBLE` instead of transcribing it, so it needs no exemption and must keep
 *     needing none;
 *   - `ring-*` with no focus variant at all: a resting ring is a border, not a focus indicator.
 *
 * The fix at a reported site is almost always deleting the ring classes and adding `focus-ring`.
 */
import { attributeName, literalText } from '../jsx.ts'
import type { Node, Rule, RuleContext } from '../types.ts'

// The kit is where the primitives live; out of scope, the rule would skip the code it was cut for.
const SCOPES = ['/apps/ui/src/', '/packages/kit/src/', '/packages/plugin-sdk/src/', '/plugins/']

/**
 * The primitives that DEFINE the focus contract. They are allowed to spell it out because every
 * other control gets it by using them; each is a shared primitive, never a feature or a plugin.
 *
 * REPO-RELATIVE paths, and `no-adhoc-focus-ring.test.ts` asserts every one of them exists on disk.
 * The list was written as loose fragments (`shared/ui/toggle.tsx`, `shared/ui/segmented-control`)
 * and rotted silently: `toggle.tsx` had been deleted, and the segmented control moved to the SDK,
 * where the `shared/ui/` fragment stopped matching it — so the one file in the repo that still
 * hand-spells a `peer-focus-visible:` ring was exempt on paper and reportable in fact. A fragment
 * cannot be checked; a path can.
 */
export const CONTRACT_OWNERS = [
  'packages/plugin-sdk/src/ui/classes.ts',
  'packages/plugin-sdk/src/ui/segmented-control.tsx',
  'packages/kit/src/controls/button-variants.ts',
  'packages/kit/src/controls/input-group.tsx',
]

/**
 * A ring utility behind a focus variant — the hand-rolled focus indicator this rule replaces.
 *
 * The PARENT-side variants are matched too. Only `focus:`/`focus-visible:` were, and the two
 * spellings a composite control reaches for — `focus-within:` and `has-[:focus-visible]:` — walked
 * straight past it: a `focus-within:ring-accent/20` in the database plugin and a
 * `focus-within:ring-foreground/15` in the model picker are exactly the drift this rule exists to
 * stop, and neither was ever reported. `focus-within:` is doubly worth catching, since it has no
 * keyboard-only semantics at all and lights the ring up on a plain mouse click.
 */
const ADHOC_FOCUS_RING =
  /\b(?:focus(?:-visible|-within)?|has-\[:focus-visible\]|peer-focus(?:-visible)?|group-focus(?:-visible|-within)?):ring(?:-[\w[\]/.-]+)?\b/u

export const noAdhocFocusRing: Rule = {
  create(context: RuleContext) {
    if (!SCOPES.some((scope) => context.filename.includes(scope))) return {}
    if (CONTRACT_OWNERS.some((owner) => context.filename.includes(owner))) return {}
    return {
      JSXAttribute(node: Node) {
        if (attributeName(node) !== 'className') return
        const text = literalText(node.value as Node | undefined)
        if (text === null || !ADHOC_FOCUS_RING.test(text)) return
        context.report({
          node,
          message:
            'Hand-rolled focus ring. Keyboard focus has one recipe: drop the `focus-visible:ring-*` classes and add the `focus-ring` utility, or build the control on a shared primitive that already carries it.',
        })
      },
    }
  },
}
