import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Switch } from '@localixai/kit/switch'

interface McpToolTogglesProps {
  serverName: string
  availableTools: readonly string[]
  activeTools: readonly string[]
  disabled?: boolean
  onToolEnabled: (toolName: string, enabled: boolean) => void
}

/** Compact per-server inventory backed by the same filters the agent runtime reads. */
export function McpToolToggles({
  serverName,
  availableTools,
  activeTools,
  disabled,
  onToolEnabled,
}: McpToolTogglesProps) {
  const tools = [...new Set(availableTools)].sort((a, b) => a.localeCompare(b))
  const active = new Set(activeTools)
  if (tools.length === 0) return null

  return (
    <ul
      className="scrollbar-thin mt-2 ml-5 max-h-40 overflow-y-auto border-y border-border-faint"
      aria-label={`${serverName} tools`}
    >
      {tools.map((toolName) => {
        const enabled = active.has(toolName)
        return (
          <li
            key={toolName}
            className="flex min-h-[var(--chrome-control-lg)] items-center justify-between gap-3 border-b border-border-faint px-1 last:border-b-0"
          >
            <code
              className={cn(
                'min-w-0 truncate text-xs',
                enabled ? 'text-text-soft' : 'text-text-faint',
              )}
              title={toolName}
            >
              {toolName}
            </code>
            <Switch
              checked={enabled}
              disabled={disabled}
              onChange={() => onToolEnabled(toolName, !enabled)}
              aria-label={`${enabled ? 'Disable' : 'Enable'} ${serverName} tool ${toolName}`}
            />
          </li>
        )
      })}
    </ul>
  )
}
