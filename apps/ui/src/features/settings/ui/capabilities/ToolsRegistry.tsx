import { useMemo } from 'react'
import { useCapabilityTools, type CapabilityToolRow } from '../../model/useCapabilityTools'
import { SettingProblems, SettingRegistryList } from '../settingRegistry'
import { CapabilityRegistryBody } from './CapabilityRegistryBody'
import { ToolRow } from './ToolRow'
import { SettingsSection } from '../SettingsScaffold'

/** Category id → its rows, in the order the backend listed the categories. */
function byCategory(tools: CapabilityToolRow[], labels: Record<string, string>) {
  const order = Object.keys(labels)
  const groups = new Map<string, CapabilityToolRow[]>()
  for (const tool of tools) {
    const bucket = groups.get(tool.category)
    if (bucket) bucket.push(tool)
    else groups.set(tool.category, [tool])
  }
  const rank = (id: string) => {
    const index = order.indexOf(id)
    return index === -1 ? order.length : index
  }
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([id, rows]) => ({ id, label: labels[id] ?? id, rows }))
}

/**
 * Settings → Capabilities → Tools: every tool the scope knows about, with a switch.
 *
 * The same registry shape as Skills, MCP and Plugins, on purpose. Tools were the exception —
 * the tab showed the rule editor and nothing else, so a person could write `tool:bash * deny`
 * but had nowhere to see that `bash` was consequently off, and no way to find out which of
 * forty tools a role actually held. Four kinds, one list, one switch, one rule behind it.
 */
export function ToolsRegistry({ scope }: { scope: string }) {
  const { tools, categoryLabels, loading, error, busy, mutationError, refresh, setEnabled } =
    useCapabilityTools(scope)
  const groups = useMemo(() => byCategory(tools, categoryLabels), [tools, categoryLabels])

  return (
    <div className="w-full space-y-8">
      <SettingProblems
        subject="Tools"
        errors={[error, mutationError].filter((message): message is string => Boolean(message))}
        onRetry={refresh}
        className="mb-3"
      />
      <CapabilityRegistryBody
        count={tools.length}
        loading={loading}
        error={error}
        list={false}
        empty="No tools are available in this scope yet."
      >
        {groups.map((group) => (
          <SettingsSection key={group.id} title={group.label}>
            <SettingRegistryList>
              {group.rows.map((tool) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  busy={busy === tool.name}
                  onToggle={(enabled) => void setEnabled(tool, enabled)}
                />
              ))}
            </SettingRegistryList>
          </SettingsSection>
        ))}
      </CapabilityRegistryBody>
    </div>
  )
}
