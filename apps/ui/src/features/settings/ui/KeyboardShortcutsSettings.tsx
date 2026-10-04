import { useCallback, useMemo, useState } from 'react'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  CUSTOM_PRESET_ID,
  KEYMAP_PRESETS,
  SHORTCUT_CATALOG,
  chordToTokens,
  conflictingCommands,
  formatModifierText,
  type Chord,
  type ShortcutCategory,
  type ShortcutCommand,
} from '@/shared/lib/keybindings'
import { requestConfirmation } from '@/shared/lib/confirmAction'
import { useKeybindingsEditor } from '../model/useKeybindings'
import { SettingsPage, SettingsRow, SettingsRows } from './SettingsScaffold'
import { SearchInput } from '@localixai/kit/search-input'
import { Button } from '@localixai/kit/button'
import { Select, type SelectOption } from '@localixai/kit/select'
import { ShortcutRow } from './keyboard/ShortcutRow'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { SectionLabel } from '@localixai/kit/section-label'

/** Does a command match the free-text query (label, description, or rendered keys)? */
function commandMatches(command: ShortcutCommand, chordText: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    command.label.toLowerCase().includes(q) ||
    command.description.toLowerCase().includes(q) ||
    chordText.toLowerCase().includes(q)
  )
}

export function KeyboardShortcutsSettings() {
  const { resolved, isOverridden, setBinding, resetBinding, resetAll, activePreset, applyPreset } =
    useKeybindingsEditor()
  const [query, setQuery] = useState('')

  // Preset picker options: the real presets, plus a read-only "Custom" entry
  // surfaced only while the live overrides match no preset (e.g. a hand-edit). Each says what it
  // is under its name: a line beside the field described only the CURRENT preset, so comparing
  // two meant applying one — which rewrites the whole keymap.
  const presetOptions: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = KEYMAP_PRESETS.map((p) => ({
      value: p.id,
      label: p.label,
      description: p.description,
    }))
    if (activePreset === CUSTOM_PRESET_ID)
      opts.push({
        value: CUSTOM_PRESET_ID,
        label: 'Custom',
        description: 'Your bindings differ from every preset.',
      })
    return opts
  }, [activePreset])

  // Names of the other commands a candidate chord for `commandId` would clash
  // with — shared by the record-time confirm and the post-hoc "Also:" badge.
  const conflictLabelsFor = useCallback(
    (commandId: string, chord: Chord) =>
      conflictingCommands(commandId, chord, resolved).map((c) => c.label),
    [resolved],
  )

  // Group the (filtered) catalog by category, preserving the declared order.
  const grouped = useMemo(() => {
    const byCategory = new Map<ShortcutCategory, ShortcutCommand[]>()
    for (const command of SHORTCUT_CATALOG) {
      const chordText = chordToTokens(resolved[command.id] ?? null).join(' ')
      if (!commandMatches(command, chordText, query)) continue
      const list = byCategory.get(command.category) ?? []
      list.push(command)
      byCategory.set(command.category, list)
    }
    return CATEGORY_ORDER.flatMap((category) => {
      const commands = byCategory.get(category) ?? []
      return commands.length > 0 ? [{ category, commands }] : []
    })
  }, [resolved, query])

  const hasOverrides = SHORTCUT_CATALOG.some((c) => isOverridden(c.id))

  return (
    <SettingsPage
      title="Keyboard shortcuts"
      description={`Rebind the app's commands. Bindings adapt to your OS — shown as ${formatModifierText('mod')} / ${formatModifierText('alt')} here. Click a shortcut to record a new combination; built-in interaction keys are listed for reference.`}
    >
      <SettingsRows>
        <SettingsRow layout="responsive">
          <div id="base-keymap-label" className="min-w-0 text-sm font-medium text-foreground">
            Base keymap
          </div>
          <Select
            aria-labelledby="base-keymap-label"
            value={activePreset}
            onValueChange={(id) => {
              if (id !== CUSTOM_PRESET_ID) applyPreset(id)
            }}
            options={presetOptions}
            className="w-52 shrink-0 @max-md:w-full"
            contentClassName="w-80"
          />
        </SettingsRow>
      </SettingsRows>

      <div className="flex items-center gap-3">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search shortcuts…"
          className="flex-1"
        />
        <Button
          variant="outline"
          size="sm"
          // Asked first: one click drops every rebind the person has ever made, all at once, and
          // the per-row Reset beside each shortcut is the un-asked version of the same act because
          // it undoes exactly one.
          onClick={() =>
            requestConfirmation({
              kind: 'reset-shortcuts',
              title: 'Reset every keyboard shortcut?',
              detail:
                'Drops all of your rebinds and puts the whole keymap back to its defaults. This cannot be undone.',
              confirmLabel: 'Reset all',
              variant: 'destructive',
              perform: resetAll,
            })
          }
          disabled={!hasOverrides}
          className="shrink-0"
        >
          Reset all
        </Button>
      </div>

      {grouped.length === 0 ? (
        <EmptyHint className="py-8">No shortcuts match “{query}”.</EmptyHint>
      ) : (
        grouped.map(({ category, commands }) => (
          <section key={category} className="space-y-2">
            <h3>
              <SectionLabel as="span" weight="semibold">
                {CATEGORY_META[category].label}
              </SectionLabel>
            </h3>
            <SettingsRows>
              {commands.map((command) => (
                <ShortcutRow
                  key={command.id}
                  command={command}
                  chord={resolved[command.id] ?? null}
                  overridden={isOverridden(command.id)}
                  conflictLabels={conflictLabelsFor(command.id, resolved[command.id] ?? null)}
                  conflictsFor={(chord) => conflictLabelsFor(command.id, chord)}
                  onRecord={(chord) => setBinding(command.id, chord)}
                  onUnassign={() => setBinding(command.id, null)}
                  onReset={() => resetBinding(command.id)}
                />
              ))}
            </SettingsRows>
          </section>
        ))
      )}
    </SettingsPage>
  )
}
