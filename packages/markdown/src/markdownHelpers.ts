import { isValidElement, type ReactNode } from 'react'

export function getLanguage(className?: string): string | undefined {
  return /language-([^\s]+)/.exec(className ?? '')?.[1]
}

/** Flatten a markdown node's children to their plain text (elements → their own children). */
export function childrenToText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => childrenToText(child as ReactNode)).join('')
  if (isValidElement(node)) {
    return childrenToText((node.props as { children?: ReactNode }).children)
  }
  return ''
}

export function isCodeBlock(children: ReactNode, className?: string): boolean {
  return Boolean(getLanguage(className)) || childrenToText(children).includes('\n')
}
