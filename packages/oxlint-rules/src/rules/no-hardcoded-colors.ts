/**
 * A colour that PAINTS a surface must come from a token.
 *
 * The theme lives in CSS custom properties, so a literal colour written into a `style` prop or a
 * Tailwind arbitrary value is the one kind of colour that cannot follow the workspace theme: it
 * stays the same in light and dark, and it ignores every theme preset a plugin might install.
 *
 * Scope is deliberately narrow, and the narrowness is the point. A colour literal is only wrong
 * where it PAINTS; it is ordinary data everywhere else. `SpaceColorPicker` offers hex values to the
 * user, `ChartCanvas` keeps a hex fallback for `readVar` because a `<canvas>` cannot resolve a CSS
 * variable, and both are correct. A rule that matched every string literal — as the reference
 * implementation this was taken from does — would report those thirty legitimate values and be
 * turned off within a week.
 *
 * A literal used as a `var()` FALLBACK is also correct and is stripped before matching. The root
 * error boundary paints `var(--color-background, #070707)` precisely because it has to render when
 * the stylesheet that defines the token never loaded, and a rule that reported that would be asking
 * the crash screen to depend on the thing that crashed.
 */
import { attributeName, literalText } from '../jsx.ts'
import type { Node, Rule, RuleContext } from '../types.ts'

/** A `var()` call including its fallback — removed before matching, fallback and all. */
const VAR_CALL = /var\([^()]*(?:\([^()]*\)[^()]*)*\)/gu
/** Hex, or a functional colour notation. Bare keywords are fine and are not matched. */
const PAINTED_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color)\(/u
/** A Tailwind arbitrary value carrying a literal colour: `bg-[#abc]`, `text-[rgb(0_0_0)]`. */
const ARBITRARY_COLOR = /\[(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab)\()/u

/** The text with every `var()` call removed, so a token's fallback is not read as a painted colour. */
function paintedPart(text: string): string {
  return text.replaceAll(VAR_CALL, '')
}

function styleObject(node: Node): Node | null {
  const value = node.value as Node | undefined
  if (value?.type !== 'JSXExpressionContainer') return null
  const expression = value.expression as Node | undefined
  return expression?.type === 'ObjectExpression' ? expression : null
}

export const noHardcodedColors: Rule = {
  create(context: RuleContext) {
    return {
      JSXAttribute(node: Node) {
        const name = attributeName(node)

        if (name === 'style') {
          const object = styleObject(node)
          if (object === null) return
          for (const property of (object.properties as Node[] | undefined) ?? []) {
            if (property.type !== 'Property') continue
            const text = literalText(property.value as Node | undefined)
            if (text !== null && PAINTED_COLOR.test(paintedPart(text))) {
              context.report({
                node: property,
                message: `Literal colour '${text}' in a \`style\` prop cannot follow the theme. Use a token: \`var(--foreground)\`, \`var(--border)\`, or a class that resolves one.`,
              })
            }
          }
          return
        }

        if (name === 'className') {
          const text = literalText(node.value as Node | undefined)
          if (text !== null && ARBITRARY_COLOR.test(paintedPart(text))) {
            context.report({
              node,
              message: `Tailwind arbitrary colour in \`className\` cannot follow the theme. Use a token-backed utility instead of an inline colour value.`,
            })
          }
        }
      },
    }
  },
}
