import { setIslandEnabled, useIslandEnabled } from '@/shared/lib/islandSetting'
import { TipPick } from '../TipPick'
import './island-scene.css'

/**
 * The agent island at the notch, while another app is in front: the folded notch glows while an
 * agent works; a request that needs the person opens it into the app's own request card — the
 * chat it comes from, its title, the command, Deny and Approve — and once answered it folds back
 * to the bare notch. No chat: the island only carries what waits for an answer.
 */
export function IslandScene() {
  return (
    <div aria-hidden className="wt-island">
      <div className="wt-is-screen">
        <span className="wt-is-menubar" />
      </div>
      <div className="wt-is-notch">
        <span className="wt-is-glow" />
        <div className="wt-is-card">
          <span className="wt-is-session">Release notes</span>
          <b className="wt-is-title">Confirm command execution</b>
          <code className="wt-is-cmd">bun test src/release.test.ts</code>
          <span className="wt-is-foot">
            <span className="wt-is-deny">Deny</span>
            <span className="wt-is-approve">Approve</span>
          </span>
        </div>
      </div>
    </div>
  )
}

/** The sentence ends in the real switch: On lets requests open the island, Off keeps it away. */
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
