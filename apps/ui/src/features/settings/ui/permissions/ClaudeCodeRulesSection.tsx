import useSWR from 'swr'
import { backendClient } from '@/shared/api/client'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { SettingsRow, SettingsRows, SettingsSection, SettingsSurface } from '../SettingsScaffold'
import { ACTION_COLORS } from './permissionActionColors'

const EFFECT_ORDER = ['deny', 'ask', 'allow'] as const

/** `acceptEdits` and friends as Claude Code names them; shown as written so nothing is lost. */
const MODE_NOTE =
  'The mode a conversation starts in. A mode Localix has no match for starts in Default.'

/**
 * The permission rules of the person's Claude Code settings, read-only.
 *
 * Localix already honours them at every run's gate, so a person who set rules up in Claude Code
 * needs to SEE them next to the list they can edit here: a deny anywhere refuses, an ask turns an
 * allow into a question, and nothing here can loosen them. Edit them where they live — the
 * files named on each row.
 */
export function ClaudeCodeRulesSection({ projectId }: { projectId: string }) {
  const { data, error } = useSWR(['claude-code-permissions', projectId], () =>
    backendClient.fetchClaudeCodePermissions(projectId || undefined),
  )
  const rules = data
    ? EFFECT_ORDER.flatMap((effect) => data.rules.filter((rule) => rule.effect === effect))
    : []
  return (
    <SettingsSection
      title="From Claude Code settings"
      description="Rules and the starting mode from your Claude Code settings files. They apply to every agent, and a deny or ask here wins over an allow in the list above. Edit them in the files shown."
    >
      <SettingsSurface>
        {error ? (
          <p role="alert" className="text-xs text-status-error">
            Could not read your Claude Code settings.
          </p>
        ) : !data ? null : (
          <SettingsRows role="list">
            <SettingsRow layout="responsive">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-foreground">Default mode</p>
                <p className="max-w-prose text-xs leading-5 text-text-soft">{MODE_NOTE}</p>
              </div>
              <p className="font-mono text-xs text-foreground">{data.defaultMode ?? 'not set'}</p>
            </SettingsRow>
            {data.bypassDisabled && (
              <SettingsRow>
                <p className="text-xs text-text-soft">
                  Bypass mode is disabled by <code className="font-mono">permissions</code> in your
                  settings.
                </p>
              </SettingsRow>
            )}
            {rules.length === 0 ? (
              <SettingsRow>
                <p className="text-xs text-text-soft">
                  No permission rules in your Claude Code settings.
                </p>
              </SettingsRow>
            ) : (
              rules.map((rule) => (
                <SettingsRow key={`${rule.effect}:${rule.rule}:${rule.file}`} layout="responsive">
                  <div role="listitem" className="min-w-0 space-y-0.5">
                    <p className="truncate font-mono text-xs text-foreground">{rule.rule}</p>
                    <p className="truncate text-2xs text-text-soft">{rule.file}</p>
                  </div>
                  <span
                    className={cn(
                      'text-xs font-medium uppercase tracking-wide',
                      ACTION_COLORS[rule.effect],
                    )}
                  >
                    {rule.effect}
                  </span>
                </SettingsRow>
              ))
            )}
          </SettingsRows>
        )}
      </SettingsSurface>
    </SettingsSection>
  )
}
