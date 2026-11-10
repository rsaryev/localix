import { readCommandLine } from '@rsaryev/llx-plugin/settings'
import type { ClaudeSettings } from './read'

export interface SettingsCommandLine {
  command: string
  padding: number
  refreshInterval?: number
}

/** `statusLine` or `subagentStatusLine` as the kit lets it run (`readCommandLine`), else undefined. */
export function settingsCommandLine(
  settings: ClaudeSettings,
  key: 'statusLine' | 'subagentStatusLine',
): SettingsCommandLine | undefined {
  const policy = settings.policy()
  const value = readCommandLine(policy.view, key, policy.hooks).runs?.value
  if (!value?.command.trim()) return undefined
  const padding =
    typeof value.padding === 'number' && value.padding > 0 ? Math.floor(value.padding) : 0
  const refresh = value.refreshInterval
  return {
    command: value.command,
    padding,
    ...(typeof refresh === 'number' ? { refreshInterval: refresh } : {}),
  }
}
