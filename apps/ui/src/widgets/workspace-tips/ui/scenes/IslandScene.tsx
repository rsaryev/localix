import type { CSSProperties } from 'react'
import { ArrowUp, Folder, History, Plus } from 'lucide-react'
import { setIslandEnabled, useIslandEnabled } from '@/shared/lib/islandSetting'
import { TipPick } from '../TipPick'
import './island-scene.css'

/**
 * The agent island at the notch: the folded pill glows while an agent works, then opens into
 * the quick request card — the toolbar row, a request being typed and the send button — and
 * folds back.
 */
export function IslandScene() {
  const message = 'Summarize what changed today'
  return (
    <div aria-hidden className="wt-island">
      <div className="wt-is-screen">
        <span className="wt-is-menubar" />
      </div>
      <div className="wt-is-notch">
        <span className="wt-is-glow" />
        <div className="wt-is-card">
          <span className="wt-is-tools">
            <History className="size-2.5" />
            <Plus className="size-2.5" />
            <span className="wt-chip wt-is-folder">
              <Folder />
              localix
            </span>
          </span>
          <span className="wt-is-input">
            {[...message].map((letter, i) => (
              <span key={i} className="wt-is-letter" style={{ '--i': i } as CSSProperties}>
                {letter}
              </span>
            ))}
            <span className="wt-is-caret" />
            <span className="wt-is-send">
              <ArrowUp className="size-2.5" />
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

/** The sentence ends in the real switch: On shows the island now, Off hides it. */
export function IslandAction() {
  const enabled = useIslandEnabled()
  if (enabled === null) return null
  return (
    <TipPick
      label="Agent island"
      value={enabled ? 'On' : 'Off'}
      entries={[true, false].map((on) => ({
        id: on ? 'on' : 'off',
        label: on ? 'On' : 'Off',
        selected: on === enabled,
        onSelect: () => setIslandEnabled(on),
      }))}
    />
  )
}
