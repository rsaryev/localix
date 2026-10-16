/**
 * WHO A PARTICIPANT'S REPLY HANDS THE FLOOR TO.
 *
 * In a conversation an `@handle` in a reply is an address: the named colleague answers next, and
 * reads that very reply as its brief. It replaced a terminal `conversation_control` call whose
 * arguments duplicated the reply as a hidden note; models end a response with its text, so the
 * call cost a second model request on almost every turn.
 *
 * Only prose addresses. A handle quoted as code, shown in a fenced block, cited in a block quote or
 * buried in a link target is a reference to the participant, never a request — the same
 * distinction a person draws reading the message. Everything else is `agent-mentions`' grammar.
 */
import { mentionedHandles } from './agent-mentions'

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const QUOTE = /^\s{0,3}>/
const INLINE_CODE = /(`+)[^`]*?\1/g
const LINK_TARGET = /\]\([^)]*\)/g
const AUTOLINK = /<[a-z][a-z0-9+.-]*:[^>\s]*>/gi

/** The prose of a Markdown reply, with code, quotes and link targets blanked out. */
export function addressableProse(markdown: string): string {
  let fence: string | null = null
  const lines = markdown.split('\n').map((line) => {
    const opener = FENCE.exec(line)?.[1]
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null
      return ''
    }
    if (opener) {
      fence = opener
      return ''
    }
    if (QUOTE.test(line)) return ''
    return line.replace(INLINE_CODE, ' ').replace(LINK_TARGET, '] ').replace(AUTOLINK, ' ')
  })
  return lines.join('\n')
}

/** The known handles a reply addresses, in order of first appearance, deduplicated. */
export function addressedHandles(markdown: string, known: readonly string[]): string[] {
  return mentionedHandles(addressableProse(markdown), known)
}
