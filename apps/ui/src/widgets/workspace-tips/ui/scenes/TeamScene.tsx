import type { CSSProperties } from 'react'
import { UserPlus, X } from 'lucide-react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import './team-scene.css'

/** Two agents of the starter team (`starter-team.ts`), as the Add participant menu lists them. */
const CANDIDATES = [
  { id: 'frontend', label: 'Frontend' },
  { id: 'qa', label: 'QA Engineer' },
]

function Party({ id, label, className }: { id: string; label: string; className?: string }) {
  return (
    <span className={`wt-tm-party ${className ?? ''}`}>
      <MonogramAvatar identity={id} label={label} size={12} />
      {label}
      <X className="size-2 text-text-faint" />
    </span>
  )
}

/**
 * The participants strip: Add participant opens the agent list, Frontend joins the chat,
 * and the message hands it the turn with `@frontend`.
 */
export function TeamScene() {
  const message = '@frontend take the layout at 390px'
  return (
    <div aria-hidden className="wt-team">
      <div className="wt-pane wt-tm-menu">
        <span className="wt-tm-hover" />
        {CANDIDATES.map(({ id, label }) => (
          <span key={id} className="wt-row">
            <MonogramAvatar identity={id} label={label} size={12} />
            {label}
          </span>
        ))}
      </div>
      <div className="wt-pane wt-tm-composer">
        <div className="wt-tm-strip">
          <Party id="localix" label="Localix" />
          <Party id="frontend" label="Frontend" className="wt-tm-joined" />
          <span className="wt-tm-add">
            <UserPlus className="size-2.5" />
          </span>
        </div>
        <span className="wt-tm-input">
          <span className="wt-tm-ph">Describe the outcome you want…</span>
          {[...message].map((letter, i) => (
            <span key={i} className="wt-tm-letter" style={{ '--i': i } as CSSProperties}>
              {letter}
            </span>
          ))}
          <span className="wt-tm-caret" />
        </span>
      </div>
    </div>
  )
}
