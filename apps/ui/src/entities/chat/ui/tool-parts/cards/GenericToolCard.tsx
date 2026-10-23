import type { ToolCallItem } from '@localixai/agent/agents'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, OutputBlock, ToolBody } from '../ToolIO'
import {
  isItemStreaming,
  hasItemError,
  isItemDeclined,
  statusLabel,
  itemErrorHeadline,
  itemErrorMessage,
} from '../itemHelpers'
import { toolMeta } from './meta'
import { pretty } from './format'

/**
 * Fallback card for tools without a specialized card (mini app tools, new
 * built-ins before they get one). Name + IN/OUT/ERR rows. Errors from
 * dismissed/aborted interactions render muted, not alarming.
 */
export function GenericToolCard({ item }: { item: ToolCallItem }) {
  const streaming = isItemStreaming(item)
  // A call the person declined is theirs, not a fault: neutral, like a dismissed card.
  const isDismissed =
    item.error?.kind === 'dismissed' ||
    item.error?.kind === 'aborted' ||
    item.status === 'aborted' ||
    isItemDeclined(item)
  const errorMsg = itemErrorMessage(item)
  return (
    <ToolLine
      icon={toolMeta(item.name).icon}
      title={item.name}
      subtitle={
        streaming
          ? `${item.activeVerb}…`
          : // "Failed" was the whole story until you expanded the card. The runtime already
            // says WHY; this only had to read it.
            (itemErrorHeadline(item) ?? (errorMsg ? 'Failed' : statusLabel(item.status)))
      }
      isLoading={streaming}
      hasError={hasItemError(item) && !isDismissed}
      isDismissed={isDismissed}
      // Follow-mode: generic tools stay collapsed while running; a real failure
      // opens the card (and stays open — the signal never falls). Init-only
      // `defaultOpen` missed errors that arrived after mount.
      autoOpen={Boolean(errorMsg) && !isDismissed}
    >
      <ToolBody>
        {item.input !== undefined && (
          <IORow label="IN">
            <OutputBlock linkify>{pretty(item.input)}</OutputBlock>
          </IORow>
        )}
        {item.resultText && (
          <IORow label="OUT">
            <OutputBlock linkify>{item.resultText}</OutputBlock>
          </IORow>
        )}
        {!isDismissed && <ErrorRow message={errorMsg} />}
      </ToolBody>
    </ToolLine>
  )
}
