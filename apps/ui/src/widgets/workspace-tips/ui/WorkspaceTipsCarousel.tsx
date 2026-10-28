import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { useFeaturedCommand } from '@/shared/contrib/useFeaturedCommand'
// Shared scene styles first: each scene's own stylesheet overrides `.wt-pane` after it.
import './tips.css'
import { visibleTips, WORKSPACE_TIPS, type WorkspaceTip } from './workspaceTips'

/**
 * Where `id` sits among the slides shown now. A hidden slide (its requirement unmet, or
 * hidden after it was chosen) resolves to the next shown one, so the tour neither jumps
 * back to the start nor shifts when a slide appears later. Each opening starts at the first slide.
 */
function indexOf(tips: WorkspaceTip[], id: string | null): number {
  const shown = tips.findIndex((tip) => tip.id === id)
  if (shown !== -1) return shown
  const order = WORKSPACE_TIPS.findIndex((tip) => tip.id === id)
  if (order === -1) return 0
  const next = tips.findIndex((tip) => WORKSPACE_TIPS.indexOf(tip) > order)
  return next === -1 ? tips.length - 1 : next
}

/** A scene's loop length from its own `--loop`, so one pass ends where the scene restarts. */
function loopMs(stage: HTMLElement | null): number {
  const scene = stage?.querySelector<HTMLElement>('[data-layer="in"] > *')
  const seconds = scene
    ? Number.parseFloat(getComputedStyle(scene).getPropertyValue('--loop'))
    : Number.NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 8000
}

/**
 * The setup tour, shown in the setup dialog (`SetupDialog`). Nothing here changes the workspace
 * unless a control in it is used; the last step hands back to the chat with `onFinish`.
 *
 * One column, one width: the scene, the sentence, the slide's control and the pager all
 * share the same edges, so nothing narrows as the eye moves down.
 *
 * Every scene's pane shares the column's edges and the pager keeps fixed slots, so paging
 * crossfades content in place and nothing shifts. A scene plays one pass when it arrives
 * and keeps looping only while the pointer is on the carousel.
 */
export function WorkspaceTipsCarousel({ onFinish }: { onFinish: () => void }) {
  const featuredCommand = useFeaturedCommand() !== null
  const tips = visibleTips({ featuredCommand })
  // The current slide is held by id, not position: a slide that appears once plugins load
  // must not move the person to a different tip.
  const [{ id, leaving }, setState] = useState<{
    id: string | null
    leaving: WorkspaceTip | null
  }>({ id: null, leaving: null })
  const [engaged, setEngaged] = useState(false)
  const [firstPass, setFirstPass] = useState(true)
  const stageRef = useRef<HTMLDivElement>(null)
  const index = indexOf(tips, id)
  const tip = tips[index] ?? tips[0]

  // A new slide starts a new first pass: reset while rendering, so no frame shows the old state.
  const [passTipId, setPassTipId] = useState(tip?.id)
  if (passTipId !== tip?.id) {
    setPassTipId(tip?.id)
    setFirstPass(true)
  }
  useEffect(() => {
    const timer = window.setTimeout(() => setFirstPass(false), loopMs(stageRef.current))
    return () => window.clearTimeout(timer)
  }, [tip?.id])

  if (!tip) return null
  const isFirst = index === 0
  const isLast = index === tips.length - 1

  const go = (next: number) => {
    const target = tips[next]
    if (!target || next === index) return
    setState({ id: target.id, leaving: tip })
  }

  // Arrow keys on the progress bar page and carry focus along, like a tab list.
  const onSegmentKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const next = index + step
    if (step === 0 || next < 0 || next >= tips.length) return
    event.preventDefault()
    go(next)
    const segments = event.currentTarget.parentElement?.children
    ;(segments?.[next] as HTMLElement | undefined)?.focus()
  }

  return (
    <div
      className="wt-root flex w-full justify-center"
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
    >
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label="Workspace tips"
        className="flex w-full max-w-[36rem] flex-col"
      >
        <div ref={stageRef} className="wt-stage" data-play={firstPass || engaged || undefined}>
          {leaving ? (
            <div
              key={leaving.id}
              data-layer="out"
              className="wt-layer"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget)
                  setState((state) => ({ ...state, leaving: null }))
              }}
            >
              <leaving.Scene />
            </div>
          ) : null}
          <div key={tip.id} data-layer="in" className="wt-layer">
            <tip.Scene />
          </div>
        </div>

        <section
          key={tip.id}
          aria-roledescription="slide"
          aria-label={tip.lead}
          className="wt-slide flex flex-col"
        >
          <p className="wt-copy mt-6 min-h-[3lh] font-heading text-xl/snug font-medium tracking-tight text-pretty">
            <span className="text-text-strong">{tip.lead}</span>{' '}
            <span className="text-text-faint">{tip.rest}</span>
            {tip.Action ? (
              <>
                {' '}
                <tip.Action />
              </>
            ) : null}
          </p>
        </section>

        {/* Equal fixed slots either side, so the bar never resizes when Next becomes Start
            chatting. Ghost buttons pull out by their padding: the arrows, not invisible
            button edges, meet the column's edges. */}
        <nav
          aria-label="Tips"
          className="mt-8 grid grid-cols-[8.5rem_minmax(0,1fr)_8.5rem] items-center gap-4"
        >
          <Button
            variant="ghost"
            size="lg"
            className="-ml-2 justify-self-start"
            disabled={isFirst}
            onClick={() => go(index - 1)}
          >
            <ArrowLeft data-icon="inline-start" aria-hidden />
            Previous
          </Button>
          <div className="flex items-center gap-1.5">
            {tips.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Show tip: ${item.lead}`}
                aria-current={i === index}
                data-state={i === index ? 'current' : i < index ? 'done' : 'todo'}
                className="wt-seg"
                tabIndex={i === index ? 0 : -1}
                onKeyDown={onSegmentKey}
                onClick={() => go(i)}
              />
            ))}
          </div>
          {/* The tour ends where the work starts: the last step closes setup onto the chat the
              launch opened, instead of looping back. */}
          {isLast ? (
            <Button variant="mono" size="lg" className="justify-self-end" onClick={onFinish}>
              Start chatting
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="lg"
              className="-mr-2 justify-self-end"
              onClick={() => go(index + 1)}
            >
              Next
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          )}
        </nav>
      </div>
    </div>
  )
}
