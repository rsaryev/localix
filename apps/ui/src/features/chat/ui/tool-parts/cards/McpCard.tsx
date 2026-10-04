import type { McpCallItem } from '@localixai/agent/agents'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, OutputBlock, ToolBody } from '../ToolIO'
import { isItemStreaming, hasItemError, itemErrorMessage, statusLabel } from '../itemHelpers'
import { MCP_META } from './meta'
import { pretty } from './format'

/** An MCP tool call — rendered with server/tool provenance. */
export function McpCard({ item }: { item: McpCallItem }) {
  const streaming = isItemStreaming(item)
  const errorMessage = itemErrorMessage(item)
  return (
    <ToolLine
      icon={MCP_META.icon}
      title={`${item.server} · ${item.tool}`}
      subtitle={streaming ? 'Calling…' : statusLabel(item.status)}
      isLoading={streaming}
      hasError={hasItemError(item)}
      durationMs={item.durationMs}
    >
      <ToolBody>
        {item.input !== undefined && (
          <IORow label="IN">
            <OutputBlock linkify>{pretty(item.input)}</OutputBlock>
          </IORow>
        )}
        {(item.resultText || item.result !== undefined) && (
          <IORow label="OUT">
            <OutputBlock linkify>{item.resultText ?? pretty(item.result)}</OutputBlock>
          </IORow>
        )}
        <ErrorRow message={errorMessage} />
      </ToolBody>
    </ToolLine>
  )
}
