import { useMemo } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { chordToTokens } from '@localixai/kit/keybindings'
import { CMD, KEYMAP_PRESETS, presetOverrides, resolveBindings } from '@/shared/lib/keybindings'
import { useKeybindingsEditor } from '@/features/settings/model/useKeybindings'
import { TipPick } from '../TipPick'
import './keymap-scene.css'

/** Rows that visibly change between Default and the JetBrains preset. */
const ROWS = [
  { id: CMD.commandPalette, label: 'Command palette' },
  { id: CMD.goToFile, label: 'Go to file' },
  { id: CMD.switchSession, label: 'Switch session' },
  { id: CMD.toggleSidebar, label: 'Toggle sidebar' },
]
const MENU = ['default', 'vscode', 'cursor', 'jetbrains', 'zed']

function Keys({ chord }: { chord: string | null | undefined }) {
  return (
    <span className="wt-keys">
      {chordToTokens(chord ?? null).map((t) => (
        <span key={t} className="wt-kbd">
          {t}
        </span>
      ))}
    </span>
  )
}

/**
 * Settings → Shortcuts: the Base keymap select opens, JetBrains is picked, and the rows
 * switch to that preset's real chords — both columns are resolved from the presets.
 */
export function KeymapScene() {
  const { base, jet } = useMemo(
    () => ({ base: resolveBindings({}), jet: resolveBindings(presetOverrides('jetbrains')) }),
    [],
  )
  const label = (id: string) => KEYMAP_PRESETS.find((p) => p.id === id)?.label ?? id
  return (
    <div aria-hidden className="wt-keymap">
      <div className="wt-pane wt-km-page">
        <b className="wt-km-title">Keyboard shortcuts</b>
        <div className="wt-km-base">
          <span>Base keymap</span>
          <span className="wt-km-select">
            <span className="wt-swap">
              <span className="wt-km-a">{label('default')}</span>
              <span className="wt-km-b">{label('jetbrains')}</span>
            </span>
            <ChevronDown className="size-2.5" />
          </span>
        </div>
        <span className="wt-label wt-km-cat">Navigation</span>
        {ROWS.map(({ id, label: name }) => (
          <div key={id} className="wt-km-row">
            <span>{name}</span>
            <span className="wt-swap ml-auto">
              <span className="wt-km-a">
                <Keys chord={base[id]} />
              </span>
              <span className="wt-km-b">
                <Keys chord={jet[id]} />
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="wt-pane wt-km-menu">
        <span className="wt-km-hover" />
        {MENU.map((id) => (
          <span key={id} className="wt-row">
            {label(id)}
            {id === 'default' ? <Check className="ml-auto" /> : null}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The same choice as Settings → Shortcuts → Base keymap. */
export function KeymapAction() {
  const { activePreset, applyPreset } = useKeybindingsEditor()
  const current = KEYMAP_PRESETS.find((p) => p.id === activePreset)?.label ?? 'Custom'
  return (
    <TipPick
      label="Base keymap"
      value={current}
      entries={KEYMAP_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        selected: p.id === activePreset,
        onSelect: () => {
          if (p.id !== activePreset) applyPreset(p.id)
        },
      }))}
    />
  )
}
