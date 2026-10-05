import { Switch } from '@localixai/kit/switch'
import type { CapabilityToolRow } from '../../model/useCapabilityTools'
import { SettingRegistryMeta, SettingRegistryRow } from '../settingRegistry'

/**
 * One catalog tool.
 *
 * The row's job beyond the switch is to say WHY a tool is off, because "off" has two very
 * different causes and only one of them is the user's to change. A rule someone wrote is
 * lifted by the switch; a structural absence — the owning plugin is off, the run shape does
 * not carry the tool — is not, and offering a switch that silently does nothing was how the
 * settings screen came to disagree with the turn.
 */
export function ToolRow({
  tool,
  busy,
  onToggle,
}: {
  tool: CapabilityToolRow
  busy: boolean
  onToggle: (enabled: boolean) => void
}) {
  const structural = tool.denial?.source === 'capability'
  const meta = [
    ...(tool.required ? [{ label: 'Required' }] : []),
    ...(tool.provider ? [{ label: tool.provider.label }] : []),
    ...(tool.denial ? [{ label: tool.denial.reason, tone: 'warning' as const }] : []),
  ]

  return (
    <SettingRegistryRow
      state={tool.enabled ? 'enabled' : structural ? 'neutral' : 'disabled'}
      busyLabel={busy ? `Updating ${tool.label}` : undefined}
      anchor={`tool:${tool.name}`}
      header={
        <>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium">{tool.label}</span>
            <code className="shrink-0 truncate text-2xs text-text-faint">{tool.name}</code>
          </div>
          {tool.description && (
            <p className="mt-0.5 truncate text-xs text-text-soft">{tool.description}</p>
          )}
          <SettingRegistryMeta items={meta} />
        </>
      }
      toggle={
        <Switch
          checked={tool.enabled}
          disabled={busy || structural || tool.required}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={
            tool.required
              ? `${tool.label} (required)`
              : `${tool.enabled ? 'Disable' : 'Enable'} ${tool.label}`
          }
          title={
            tool.required
              ? 'Required to finish a conversation turn and hand work to its participants.'
              : structural
                ? 'This tool is not available to the scope at all, so a rule cannot bring it back.'
                : undefined
          }
        />
      }
    />
  )
}
