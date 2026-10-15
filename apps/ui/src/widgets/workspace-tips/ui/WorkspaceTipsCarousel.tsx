import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'
import { requestNewChat } from '@/shared/lib/chatChromeBus'
// Shared scene styles first: each scene's own stylesheet overrides `.wt-pane` after it.
import './tips.css'
import { WORKSPACE_TIPS } from './workspaceTips'

const LAST_TIP_KEY = 'localix.workspaceTips.last'

function initialIndex(): number {
  const index = WORKSPACE_TIPS.findIndex((tip) => tip.id === loadString(LAST_TIP_KEY))
  return index === -1 ? 0 : index
}

/**
 * What an editor group with nothing open shows. It only fills the space: nothing here
 * takes focus or changes the workspace unless a control in it is used.
 *
 * One column, one width: the scene, the sentence, the slide's control and the pager all
 * share the same edges, so nothing narrows as the eye moves down.
 */
export function WorkspaceTipsCarousel() {
  const [{ index, dir }, setState] = useState(() => ({ index: initialIndex(), dir: 'next' }))
  const tip = WORKSPACE_TIPS[index] ?? WORKSPACE_TIPS[0]
  if (!tip) return null
  const isLast = index === WORKSPACE_TIPS.length - 1

  const go = (next: number, direction: 'next' | 'prev') => {
    const wrapped = (next + WORKSPACE_TIPS.length) % WORKSPACE_TIPS.length
    setState({ index: wrapped, dir: direction })
    saveString(LAST_TIP_KEY, WORKSPACE_TIPS[wrapped]?.id ?? null)
  }

  return (
    <div className="wt-root flex h-full w-full items-center justify-center overflow-y-auto px-8 py-10">
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label="Workspace tips"
        className="flex w-full max-w-[36rem] flex-col"
      >
        <section
          key={tip.id}
          data-dir={dir}
          aria-roledescription="slide"
          aria-label={tip.lead}
          className="wt-slide flex flex-col"
        >
          <div className="wt-stage">
            <tip.Scene />
          </div>
          <p className="wt-copy mt-6 min-h-[3lh] font-heading text-xl/snug font-medium tracking-tight text-pretty">
            <span className="text-text-strong">{tip.lead}</span>{' '}
            <span className="text-text-faint">{tip.rest}</span>
          </p>
          {/* Reserved on every slide so paging never moves the pager under the pointer. */}
          <div className="wt-action mt-4 flex h-(--chrome-control-lg) items-center">
            {tip.Action ? <tip.Action /> : null}
          </div>
        </section>

        <nav aria-label="Tips" className="mt-8 flex items-center gap-4">
          <Button variant="ghost" size="lg" onClick={() => go(index - 1, 'prev')}>
            <ArrowLeft data-icon="inline-start" aria-hidden />
            Previous
          </Button>
          <div className="flex flex-1 items-center gap-1.5">
            {WORKSPACE_TIPS.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Show tip: ${item.lead}`}
                aria-current={i === index}
                data-state={i === index ? 'current' : i < index ? 'done' : 'todo'}
                className="wt-seg"
                onClick={() => i !== index && go(i, i > index ? 'next' : 'prev')}
              />
            ))}
          </div>
          {/* The tour ends where the work starts: the last step opens a chat (the warm
              draft when there is one, as New chat does) instead of looping back. */}
          {isLast ? (
            <Button variant="mono" size="lg" onClick={requestNewChat}>
              Start chatting
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          ) : (
            <Button variant="ghost" size="lg" onClick={() => go(index + 1, 'next')}>
              Next
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          )}
        </nav>
      </div>
    </div>
  )
}
