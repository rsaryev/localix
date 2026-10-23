/**
 * The bare `rounded` Tailwind class is OFF the design system's radius scale.
 *
 * Every radius in the app derives from `--radius` (`rounded-sm|md|lg|xl|full` — see the
 * `--radius-*` tokens in `packages/kit/styles/tailwind-theme.css`), so themes and future radius
 * changes move the whole interface together. Bare `rounded` is Tailwind's own 0.25rem — a constant that sits between
 * the scale's steps and never follows the token. They concentrate in exactly the small-control
 * families the shared primitives standardize, which is how the same chip ships at three
 * different radii.
 *
 * Enforced EVERYWHERE the interface is written — the app, the kit, the SDK's UI and every plugin.
 * It began scoped to the primitives layer while the feature-level tail was migrated; leaving it
 * there would have meant the scale held in the twenty files nobody edits and drifted in the two
 * hundred that everybody does.
 *
 * The match is exact-class: `rounded` as a standalone class or variant target (`hover:rounded`),
 * never `rounded-md`, `rounded-full`, or an identifier that merely contains the word.
 */
import { attributeName, literalText } from '../jsx.ts'
import type { Node, Rule, RuleContext } from '../types.ts'

// The kit is where the primitives live; out of scope, the scale would stop holding in them.
const SCOPES = ['/apps/ui/src/', '/packages/kit/src/', '/packages/mini-app-sdk/src/', '/plugins/']

/** Bare `rounded` as a whole class token, optionally behind variants (`md:rounded`). */
const BARE_ROUNDED = /(?:^|\s)(?:[\w-]+:)*rounded(?=\s|$)/u

export const noOffScaleRadius: Rule = {
  create(context: RuleContext) {
    if (!SCOPES.some((scope) => context.filename.includes(scope))) return {}
    return {
      JSXAttribute(node: Node) {
        if (attributeName(node) !== 'className') return
        const text = literalText(node.value as Node | undefined)
        if (text !== null && BARE_ROUNDED.test(text)) {
          context.report({
            node,
            message:
              'Bare `rounded` (0.25rem) is off the `--radius` scale. Use `rounded-sm` for ≤20px controls, `rounded-md` for 24–36px, `rounded-full` for chips/counters.',
          })
        }
      },
    }
  },
}
