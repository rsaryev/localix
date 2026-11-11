import type { CSSProperties } from 'react'
import { SquareTerminal } from 'lucide-react'
import { chordToTokens, useCommandChord } from '@localixai/kit/keybindings'
import { CMD } from '@/shared/lib/keybindings'
import './palette-scene.css'

/** A command's LIVE chord as the palette prints it — rebinding updates the scene. */
function Keys({ id }: { id: string }) {
  const tokens = chordToTokens(useCommandChord(id))
  if (tokens.length === 0) return null
  return (
    <span className="wt-keys">
      {tokens.map((t) => (
        <span key={t} className="wt-kbd">
          {t}
        </span>
      ))}
    </span>
  )
}

/** Rows exactly as the palette lists them; `drop` rows are the ones the query filters out. */
const ROWS = [
  { kind: 'label', text: 'View', drop: true },
  { kind: 'row', text: 'Show Files', drop: true },
  { kind: 'label', text: 'Layout' },
  { kind: 'row', text: 'Toggle sidebar', id: CMD.toggleSidebar, drop: true },
  { kind: 'row', text: 'Maximize editor group', id: CMD.toggleEditorMaximize, first: true },
  { kind: 'row', text: 'Focus next editor group', id: CMD.focusNextGroup },
  { kind: 'row', text: 'Focus previous editor group', id: CMD.focusPrevGroup },
] as const

const FOOTER = [
  { id: CMD.goToFile, label: 'Files' },
  { id: CMD.switchSession, label: 'Sessions' },
  { id: CMD.goToSymbol, label: 'Symbols' },
]

/**
 * The palette opens on its chord, "group" is typed, and the list narrows to the
 * matching Layout commands — with the same footer of sibling palettes beneath.
 */
export function PaletteScene() {
  const openChord = chordToTokens(useCommandChord(CMD.commandPalette))
  return (
    <div aria-hidden className="wt-palette-scene">
      <span className="wt-chord">
        {openChord.map((t) => (
          <span key={t} className="wt-chord-key">
            {t}
          </span>
        ))}
      </span>
      <div className="wt-pane wt-palette">
        <div className="wt-palette-input">
          <SquareTerminal className="size-3 text-text-faint" />
          <span className="wt-q">
            <span className="wt-q-empty">Run a command…</span>
            {Array.from('group').map((letter, i) => (
              <span key={i} className="wt-q-letter" style={{ '--i': i } as CSSProperties}>
                {letter}
              </span>
            ))}
            <span className="wt-q-caret" />
          </span>
        </div>
        <div className="wt-palette-list">
          {ROWS.map((row) =>
            row.kind === 'label' ? (
              <span key={row.text} className="wt-group" data-drop={'drop' in row || undefined}>
                <span className="wt-label">{row.text}</span>
              </span>
            ) : (
              <span
                key={row.text}
                className="wt-cmd"
                data-drop={'drop' in row || undefined}
                data-first={'first' in row || undefined}
              >
                <span className="wt-row">
                  {row.text}
                  {'id' in row ? <Keys id={row.id} /> : null}
                </span>
              </span>
            ),
          )}
        </div>
        <div className="wt-palette-foot">
          {FOOTER.map(({ id, label }) => (
            <span key={label} className="inline-flex items-center gap-1">
              <Keys id={id} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
