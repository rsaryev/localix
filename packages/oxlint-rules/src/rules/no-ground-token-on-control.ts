/**
 * A CONTROL does not paint the window's ground.
 *
 * `--surface-raised` and `--surface-sunken` mix from a DARKER ground than the pane they sit on
 * (oklch 0.105 against the shell's 0.13), and `--background` IS that pane's ground. Painted on a
 * pane those tokens are correct; painted on a small control they read as an abrupt black chip over
 * the translucent theme — the bug reported four separate times across the composer chips, the
 * trading data-source select, every search field, and the model-filter pills.
 *
 * The resting fill for a control is a VEIL, which takes the pane's own colour and only adds
 * density: `bg-input/20 dark:bg-input/30` for fields and triggers, `bg-foreground/[0.04]` for
 * chips, `bg-surface-hover` / `bg-surface-active` for hover and selected.
 *
 * Deliberately NOT reported, because each is the documented correct use:
 *   - an alpha'd raised surface (`bg-surface-raised/90`) — the floating-toolbar recipe, whose
 *     frost is what makes it a material rather than a slab;
 *   - an alpha'd background (`bg-background/95`) — a sticky header, which must occlude the rows
 *     scrolling under it, in the pane's own hue;
 *   - `bg-background-solid` — the opaque companion for component fills (switch knobs, overlays).
 *
 * Scoped to the primitives — the kit package, the host composites left in `apps/ui/src/shared/ui`,
 * and the SDK's UI kit: a drifting one-off in a feature costs one screen, a drifting PRIMITIVE
 * costs every screen that uses it.
 */
import type { Node, Rule, RuleContext } from '../types.ts'

const SCOPES = ['/packages/kit/src/', '/apps/ui/src/shared/ui/', '/packages/plugin-sdk/src/ui/']

/** A control-sized element, by the classes it carries alongside the fill. */
const CONTROL_SHAPE =
  /\b(?:h-\[var\(--chrome-control|size-\[var\(--chrome-control|h-(?:5|6|7|8|9)\b|size-(?:4|5|6|7|8|9)\b|rounded-full\b|px-(?:1|1\.5|2|2\.5)\b)/u

/** A ground token painted at FULL strength — an alpha (`/90`) or `-solid` is a different thing. */
const GROUND_FILL = /\bbg-(?:surface-raised|surface-sunken|background)(?![-/\w])/u

/** Frost makes an alpha'd raised surface a material; without it the class is a slab. */
const HAS_BLUR = /\bbackdrop-blur/u

function attributeName(node: Node): string | null {
  const name = node.name as Node | undefined
  return name?.type === 'JSXIdentifier' ? (name.name as string) : null
}

function literalText(value: Node | undefined): string | null {
  if (value?.type === 'Literal') return typeof value.value === 'string' ? value.value : null
  if (value?.type === 'TemplateLiteral') {
    const quasis = value.quasis as Node[] | undefined
    return (quasis ?? []).map((quasi) => (quasi.value as { raw?: string })?.raw ?? '').join(' ')
  }
  return null
}

export const noGroundTokenOnControl: Rule = {
  create(context: RuleContext) {
    if (!SCOPES.some((scope) => context.filename.includes(scope))) return {}
    return {
      JSXAttribute(node: Node) {
        if (attributeName(node) !== 'className') return
        const text = literalText(node.value as Node | undefined)
        if (text === null) return
        if (!GROUND_FILL.test(text) || !CONTROL_SHAPE.test(text) || HAS_BLUR.test(text)) return
        context.report({
          node,
          message:
            'A control must not paint a ground token (`bg-surface-raised` / `bg-surface-sunken` / `bg-background`) — those mix darker than the pane and read as a black chip. Use a veil: `bg-input/20 dark:bg-input/30` for fields, `bg-foreground/[0.04]` for chips, `bg-surface-hover` / `bg-surface-active` for hover and selected.',
        })
      },
    }
  },
}
