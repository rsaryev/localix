import {
  Check,
  ChevronDown,
  ClipboardList,
  Folder,
  Link2,
  ShieldCheck,
  ShieldOff,
  Zap,
} from 'lucide-react'
import './approval-scene.css'

/** The four modes: labels verbatim from `permission-modes.ts`, hints cut to their first clause. */
const MODES = [
  {
    Icon: ShieldCheck,
    label: 'Default',
    hint: "The agent's own rules decide; anything they ask about waits for you.",
    current: true,
  },
  {
    Icon: ClipboardList,
    label: 'Plan',
    hint: 'Read-only: the agent investigates and presents a plan for you to review and approve.',
    tone: 'info',
  },
  {
    Icon: ShieldOff,
    label: 'Bypass',
    hint: 'No permission prompts — every ask is allowed.',
    tone: 'warning',
  },
  {
    Icon: Zap,
    label: 'Autonomous',
    hint: 'Bypass, and nobody is expected to answer.',
    tone: 'error',
  },
] as const

/**
 * A command the rules ask about waits as a confirm card above the composer — Once / This
 * session / Always, Deny or Approve. Then the shield chip opens the four permission modes.
 */
export function ApprovalScene() {
  return (
    <div aria-hidden className="wt-approval">
      <div className="wt-pane wt-confirm">
        <b className="wt-confirm-title">Confirm command execution</b>
        <code className="wt-confirm-cmd">bun test src/release.test.ts</code>
        <div className="wt-confirm-grant">
          <span className="wt-seg-opt">Once</span>
          <span className="wt-seg-opt" data-pick>
            This session
          </span>
          <span className="wt-seg-opt">Always</span>
        </div>
        <div className="wt-confirm-foot">
          <span className="wt-btn-ghost">
            Deny <span className="wt-kbd">esc</span>
          </span>
          <span className="wt-btn-mono">
            Approve <span className="wt-kbd wt-kbd-inv">↵</span>
          </span>
        </div>
      </div>

      <div className="wt-pane wt-modes">
        {MODES.map(({ Icon, label, hint, ...rest }) => (
          <span key={label} className="wt-mode" data-tone={'tone' in rest ? rest.tone : undefined}>
            <Icon className="wt-mode-icon" />
            <span className="wt-mode-text">
              <b>{label}</b>
              <span>{hint}</span>
            </span>
            {'current' in rest ? <Check className="wt-mode-check" /> : null}
          </span>
        ))}
      </div>

      <div className="wt-chips">
        <span className="wt-chip">
          <Folder /> my-app
        </span>
        <span className="wt-chip wt-chip-mode">
          <ShieldCheck /> Default <ChevronDown />
        </span>
        <span className="wt-chip">
          <Link2 /> Context <span className="wt-count">2</span> <ChevronDown />
        </span>
      </div>
      <div className="wt-pane wt-approval-composer">
        <span>Describe the outcome you want…</span>
      </div>
    </div>
  )
}
