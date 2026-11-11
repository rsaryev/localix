import useSWR from 'swr'
import { Plus } from 'lucide-react'
import { ChordHint } from '@localixai/kit/chord-hint'
import { Kbd } from '@localixai/kit/kbd'
import { SettingsControlRow, SettingsRows } from '@/features/settings/ui/SettingsScaffold'
import { backendClient } from '@/shared/api/client'
import { useFeaturedCommand } from '@/shared/contrib/useFeaturedCommand'
import { CMD } from '@/shared/lib/keybindings'
import { SettingsLink } from '../SetupLater'

const rules = (count: number) => `${count} permission rule${count === 1 ? '' : 's'}`

/**
 * Step four: how the workspace works, one row per thing a first conversation meets, each with the key
 * that starts it. Nothing here is a choice; the Claude Code row says what setup found.
 */
export function BasicsStep() {
  const featured = useFeaturedCommand()
  // Global scope: what applies in every folder. A failed read only drops the line it adds.
  const { data: claude } = useSWR(['claude-code-permissions', ''], () =>
    backendClient.fetchClaudeCodePermissions(),
  )
  const found = claude?.rules.length ?? 0

  return (
    <>
      <p className="max-w-prose text-sm leading-6 text-text-soft text-pretty">
        What a first conversation meets, and the key that starts each.
      </p>
      <SettingsRows className="mt-4">
        <SettingsControlRow
          title="Command palette"
          description="Every command, view and setting by name, Set up Localix included."
        >
          <ChordHint commandId={CMD.commandPalette} className="pl-0" />
        </SettingsControlRow>
        <SettingsControlRow
          title="Add context"
          description="Type @ in the message box to attach a file, a folder, a terminal or an earlier conversation."
        >
          <Kbd>@</Kbd>
        </SettingsControlRow>
        <SettingsControlRow
          title="Commands"
          description={
            featured
              ? `Type / for commands such as /plan, /resume and /help, and /${featured.trigger}: ${featured.description}`
              : 'Type / for commands such as /plan, /resume and /help. Plugins add their own.'
          }
        >
          <Kbd>/</Kbd>
        </SettingsControlRow>
        <SettingsControlRow
          title="Store"
          description="The + in the left rail opens the Store, where mini apps, plugins, agents and skills install."
        >
          <Plus className="size-4 text-text-faint" aria-hidden />
        </SettingsControlRow>
        <SettingsControlRow
          title="Claude Code"
          description={
            <>
              Localix uses your Claude Code files where they are: CLAUDE.md, settings, agents,
              skills and MCP servers. Nothing is copied.
              {found > 0 && (
                <>
                  {' '}
                  Found {rules(found)} from your Claude Code settings; see them in{' '}
                  <SettingsLink tab="permissions">Permissions</SettingsLink>.
                </>
              )}
            </>
          }
        >
          {null}
        </SettingsControlRow>
        <SettingsControlRow
          title="Decision models"
          description="Connect OpenRouter, and small models that cost a fraction of a cent a call drive the Browser, play board games and make choices for mini apps."
        >
          {null}
        </SettingsControlRow>
      </SettingsRows>
    </>
  )
}
