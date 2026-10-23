/** JSX node readers shared by the class-string rules. */

import type { Node } from './types.ts'

/** The attribute's plain name (`className`, `style`), or `null` for a namespaced one. */
export function attributeName(node: Node): string | null {
  const name = node.name as Node | undefined
  return name?.type === 'JSXIdentifier' ? (name.name as string) : null
}

/** The literal text of a string-ish value node, or `null` when it is dynamic. */
export function literalText(value: Node | undefined): string | null {
  if (value?.type === 'Literal') return typeof value.value === 'string' ? value.value : null
  if (value?.type === 'TemplateLiteral') {
    const quasis = value.quasis as Node[] | undefined
    return (quasis ?? []).map((quasi) => (quasi.value as { raw?: string })?.raw ?? '').join(' ')
  }
  return null
}
