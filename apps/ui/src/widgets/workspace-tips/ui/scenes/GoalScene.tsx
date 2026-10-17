import type { CSSProperties } from 'react'
import { KanbanSquare } from 'lucide-react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { useFeaturedCommand } from '@/shared/contrib/useFeaturedCommand'
import './goal-scene.css'

/** The cards the leader puts on the board: one per specialist. */
const TASKS = [
  { id: 'design', owner: 'Design', title: 'Pricing tiers and layout' },
  { id: 'frontend', owner: 'Frontend', title: 'Build the pricing page' },
  { id: 'qa', owner: 'QA', title: 'Check checkout end to end' },
]

/**
 * The featured goal command, as it runs: the composer takes the command and a goal, the
 * leader's cards land on the board with an owner per task, and the leader hands the first ready
 * card to its owner. Whether a plan waits for approval is the chat's permission mode, not this.
 */
export function GoalScene() {
  const command = useFeaturedCommand()
  const message = `/${command?.trigger ?? ''} ship a pricing page`
  return (
    <div aria-hidden className="wt-goal">
      <div className="wt-pane wt-gl-plan">
        <span className="wt-row wt-gl-head">
          <KanbanSquare />
          <span className="wt-label">Board</span>
          <span className="wt-gl-count">3 tasks</span>
        </span>
        {TASKS.map(({ id, owner, title }, i) => (
          <span key={id} className="wt-row wt-gl-task" style={{ '--i': i } as CSSProperties}>
            <span className="wt-gl-check" />
            <b>{title}</b>
            <span className="wt-gl-owner">
              <MonogramAvatar identity={id} label={owner} size={12} />
              {owner}
            </span>
          </span>
        ))}
      </div>
      <div className="wt-pane wt-gl-ask">
        <span className="wt-gl-question">
          <MonogramAvatar identity="localix" label="Localix" size={12} />
          Localix
        </span>
        <span className="wt-gl-handoff">
          <b>@design</b> take LX-2: pricing tiers and layout
        </span>
      </div>
      <div className="wt-pane wt-gl-composer">
        <span className="wt-gl-input">
          <span className="wt-gl-ph">Describe the outcome you want…</span>
          {[...message].map((letter, i) => (
            <span key={i} className="wt-gl-letter" style={{ '--i': i } as CSSProperties}>
              {letter}
            </span>
          ))}
          <span className="wt-gl-caret" />
        </span>
      </div>
    </div>
  )
}

/** The sentence ends in the command itself, in the slash menu's spelling. */
export function GoalAction() {
  const command = useFeaturedCommand()
  return command ? (
    <code className="wt-command" title={command.description}>
      /{command.trigger}
    </code>
  ) : null
}
