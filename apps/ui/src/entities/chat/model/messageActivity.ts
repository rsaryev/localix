export function shouldRenderAssistantSkeleton(input: {
  isUser: boolean
  isStreaming: boolean
  isLast: boolean
  isGenerating: boolean
  hasVisibleBody: boolean
}): boolean {
  if (input.isUser || input.hasVisibleBody) return false
  return input.isStreaming || (input.isLast && input.isGenerating)
}

/**
 * What the footer says while the run is blocked on a PERSON.
 *
 * The phase the host last announced was `thinking`, and it stayed announced across the whole
 * wait — so a card sat on screen asking the user to approve something while the line under it
 * claimed the model was still working. The run is doing exactly one thing there, and it is
 * waiting for the reader.
 */
export const AWAITING_ANSWER_LABEL = 'Waiting for your answer'

/**
 * Resolve the live footer label from reactive stream state. Returning null is the
 * hand-off signal that removes the status row and restores the settled actions.
 */
export function messageStreamStatusLabel(input: {
  isStreaming: boolean
  phaseLabel?: string
  fallbackLabel?: string
}): string | null {
  if (!input.isStreaming) return null
  return input.phaseLabel?.trim() || input.fallbackLabel?.trim() || 'Working'
}
