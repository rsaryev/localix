import { BatteryFull, Check, Wifi } from 'lucide-react'
import { AgentHeader } from './chrome'

const menus = ['File', 'Edit', 'View', 'Window']

/**
 * The agent island over another app: the notch lights while an agent works, turns warm when it
 * needs an answer, opens into a quick request card, takes the answer from a chip and folds back.
 */
export function IslandScene() {
  return (
    <div className="k-window sc-mac">
      <div className="sc-menubar">
        <b>Editor</b>
        {menus.map((menu) => (
          <span key={menu}>{menu}</span>
        ))}
        <span className="sc-menubar-status">
          <Wifi className="size-3" />
          <BatteryFull className="size-3.5" />
          11:35
        </span>
      </div>
      <div className="sc-desktop">
        <div className="sc-app-doc">
          <i style={{ width: '42%' }} />
          <i style={{ width: '88%' }} />
          <i style={{ width: '76%' }} />
          <i style={{ width: '81%' }} />
          <i style={{ width: '54%' }} />
        </div>
        <div className="sc-island">
          <div className="sc-island-card">
            <div className="sc-island-ask">
              <AgentHeader id="release" name="Release" />
              <p>Publish v2.4 to the stable channel?</p>
              <div className="sc-island-chips">
                <span className="k-chip sc-island-pick">
                  <Check className="size-2.5" />
                  Publish
                </span>
                <span className="k-chip sc-island-skip">Not yet</span>
              </div>
            </div>
            <p className="sc-island-reply">Approved. Publishing to stable.</p>
            <div className="sc-island-input">
              <span className="k-placeholder">Ask Localix…</span>
              <kbd className="k-mono">⌘⇧J</kbd>
            </div>
          </div>
          <div className="sc-notch">
            <i className="sc-notch-light" />
            <i className="sc-notch-light is-warm" />
          </div>
        </div>
      </div>
    </div>
  )
}
