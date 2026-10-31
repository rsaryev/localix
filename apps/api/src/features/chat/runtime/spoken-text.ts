/**
 * Append one text part to a reply. Each text part the model emits — after reasoning, after a tool
 * call, or as the next message of the same response — starts a paragraph, so "@design, draft it"
 * and "Here is the plan" never run together (LOCALIX-135, -156). Fragments of one part, as they
 * stream, join verbatim; whitespace already at the seam is kept.
 */
export function appendSpokenText(text: string, part: string, newPart: boolean): string {
  if (!newPart || !text || !part || /\s$/.test(text) || /^\s/.test(part)) return text + part
  return `${text}\n\n${part}`
}
