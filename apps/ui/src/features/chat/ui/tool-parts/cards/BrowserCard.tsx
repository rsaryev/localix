import type { ToolCallItem } from '@localixai/agent/agents'
import type { BrowserAction } from '@localixai/api/preview-actions'
import { ToolLine } from '../ToolLine'
import { ToolBody, IORow, OutputBlock, ErrorRow } from '../ToolIO'
import { ToolImages } from '../ToolImages'
import { isItemStreaming, hasItemError, itemErrorMessage } from '../itemHelpers'
import { toolMeta } from './meta'
import { asRecord, strField } from './format'

/**
 * action → verb, keyed with `satisfies Record<BrowserAction, string>` on the SOURCE
 * `BrowserAction` — imported from the browser-safe `@localixai/api/preview-actions` leaf,
 * a type-only re-export of the tool's closed `ACTIONS` tuple
 * (apps/api/.../browser/browser-actions.ts). Because the key type IS the
 * source union (not a `Record<string, …>` annotation, which widens keys to `string`
 * and lets a member silently go missing), adding a server action stops this file
 * compiling until it gets a verb — the map can no longer drift from the schema.
 * A missing verb still degrades to the raw action name at runtime, never a wrench.
 */
const ACTION_VERB = {
  open: 'Open',
  viewport: 'Viewport',
  close: 'Close',
  snapshot: 'Snapshot',
  take_screenshot: 'Screenshot',
  console: 'Console',
  steps: 'Steps',
  evaluate: 'Evaluate',
  history: 'History',
  goal: 'Goal',
} satisfies Record<BrowserAction, string>

const clip = (s: string, max = 24) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** One step of a batch as "action what": the keys pressed, the text typed, the target. */
function stepLabel(step: ReturnType<typeof asRecord>): string {
  const action = strField(step, 'action') ?? '?'
  const keysVal = step?.keys
  const keys = Array.isArray(keysVal)
    ? keysVal.filter((k): k is string => typeof k === 'string').join(' ')
    : undefined
  const text = strField(step, 'text')
  const what =
    action === 'press'
      ? keys || strField(step, 'key')
      : action === 'type' && text != null
        ? `"${clip(text, 16)}"`
        : action === 'scroll'
          ? strField(step, 'direction')
          : (strField(step, 'ref') ?? strField(step, 'selector'))
  return what ? `${action} ${what}` : action
}

/**
 * Rich card for `browser` — shows the action + its target (ref/selector)
 * and the model-facing result (snapshot tree / action note / console), plus the picture
 * a `take_screenshot` returned, so the user sees exactly what the agent looked at.
 */
export function BrowserCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  const errorMessage = itemErrorMessage(item)

  // `action` is read off an UNKNOWN tool-details payload, so it stays a bare string
  // the type system cannot vouch for; the typed map narrows presentation and falls
  // back to the raw name for an action this build does not know yet.
  const action = strField(input, 'action') ?? 'snapshot'
  const verb = (ACTION_VERB as Record<string, string>)[action] ?? action

  // Show WHAT was done, not just the verb: a batch's steps in order, the evaluated
  // expression, or the target — so the collapsed card is legible at a glance.
  const stepsVal = input?.steps
  const expression = strField(input, 'expression')
  const goal = strField(input, 'goal')
  const detail =
    action === 'steps' && Array.isArray(stepsVal)
      ? clip(stepsVal.map((step) => stepLabel(asRecord(step))).join(' → '), 48)
      : action === 'evaluate'
        ? expression != null
          ? clip(expression, 32)
          : undefined
        : action === 'goal'
          ? goal != null
            ? `"${clip(goal, 40)}"`
            : undefined
          : (strField(input, 'ref') ?? strField(input, 'selector'))
  const title = detail ? `${verb} ${detail}` : verb

  const subtitle = streaming ? 'Working…' : hasError ? 'Failed' : 'Browser'

  return (
    <ToolLine
      icon={toolMeta('browser').icon}
      title={title}
      subtitle={subtitle}
      isLoading={streaming}
      hasError={hasError}
    >
      <ToolBody>
        {item.resultText && !hasError && (
          <IORow label="OUT">
            <OutputBlock>{item.resultText}</OutputBlock>
          </IORow>
        )}
        <ToolImages item={item} />
        <ErrorRow message={errorMessage} />
      </ToolBody>
    </ToolLine>
  )
}
