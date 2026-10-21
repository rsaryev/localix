import { lazy, Suspense, useState, type CSSProperties } from 'react'
import { Zap } from 'lucide-react'
import type { ReasoningEffort } from '@localixai/agent'
import { useConnections } from '@/entities/chat/ui/prompt-input/useConnections'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { TipPickTrigger } from '../TipPick'
import './decision-scene.css'

const ModelPickerDrawer = lazy(() =>
  import('@/entities/chat/ui/prompt-input/ModelPickerDrawer').then((m) => ({
    default: m.ModelPickerDrawer,
  })),
)

/** One question a decision model answers: who takes the next turn, with each option's share. */
const OPTIONS = [
  { label: '@frontend', share: 0.9 },
  { label: '@design', share: 0.08 },
  { label: '@localix', share: 0.02 },
]

/**
 * A decision in miniature: one typed question, three options whose probability bars fill, and the
 * leading one picked — what the decision model answers for group routing, the Browser and games.
 */
export function DecisionScene() {
  return (
    <div aria-hidden className="wt-decision">
      <div className="wt-pane wt-dc-card">
        <span className="wt-dc-question">
          <Zap className="size-2.5" />
          Who should take the next turn?
        </span>
        {OPTIONS.map(({ label, share }, i) => (
          <span
            key={label}
            className={`wt-row wt-dc-option ${i === 0 ? 'wt-dc-picked' : ''}`}
            style={{ '--share': share, '--i': i } as CSSProperties}
          >
            <span className="wt-dc-label">{label}</span>
            <span className="wt-dc-track">
              <span className="wt-dc-bar" />
            </span>
            <span className="wt-dc-value">{Math.round(share * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** The picker opened straight on OpenRouter's sign-in — the same flow a model pick uses. */
export function DecisionAction() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [effort, setEffort] = useState<ReasoningEffort>('medium')
  const connectionsState = useConnections(null)
  const { models } = useModelsCatalog()
  const connected = connectionsState.connections.some(
    (connection) => connection.providerId === 'openrouter',
  )

  return (
    <>
      <TipPickTrigger
        label="OpenRouter"
        value={connected ? 'Connected' : 'Sign in'}
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
      />
      {mounted ? (
        <Suspense fallback={null}>
          <ModelPickerDrawer
            open={open}
            onOpenChange={setOpen}
            seed={{ providerId: 'openrouter', revision: 1 }}
            models={models}
            connectionsState={connectionsState}
            sessionModelId=""
            sessionConnectionId={null}
            onPickSessionModel={() => setOpen(false)}
            reasoningEffort={effort}
            onReasoningEffortChange={setEffort}
          />
        </Suspense>
      ) : null}
    </>
  )
}
