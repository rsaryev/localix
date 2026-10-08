import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { availableShots } from '../../generated/shots'
import { WORKFLOWS, type ShowcaseItem } from './workflowContent'
import { IconButton } from '@localixai/kit/icon-button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Screenshot } from '../Screenshot'
import { ArrowCue } from './cards'

function WorkflowContent({ item, src }: { item: ShowcaseItem; src?: string }) {
  return (
    <>
      <div className="workflow-caption">
        <h2 className="section-title text-3xl md:text-4xl">{item.title}</h2>
        <div>
          <p className="lede text-lg">{item.body}</p>
          <Link to={`/docs/${item.slug}`} className="workflow-guide group/cue focus-ring">
            Read the guide <ArrowCue reveal={false} />
          </Link>
        </div>
      </div>
      <div className="workflow-media">
        {src && (
          <Screenshot src={src} alt={item.alt} title={item.title}>
            <img
              src={src}
              alt={item.alt}
              width={1600}
              height={1000}
              loading="lazy"
              decoding="async"
              className="screenshot-thumbnail block aspect-[8/5] h-auto w-full rounded-xl border-0 object-cover"
            />
          </Screenshot>
        )}
      </div>
    </>
  )
}

/** One manual tour, with native captures and a fixed footprint at every step. */
export function WorkflowCarousel({
  items = WORKFLOWS,
  label = 'Explore the workspace',
}: {
  items?: readonly ShowcaseItem[]
  label?: string
}) {
  const shots = availableShots as Record<string, { src: string; capturedAt: string }>
  const workflows = items.filter((item) => shots[item.shot])
  const id = useId()
  const [active, setActive] = useState(0)
  const [previous, setPrevious] = useState<number | null>(null)
  const [motion, setMotion] = useState(true)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  function select(index: number, keyboard = false) {
    const next = (index + workflows.length) % workflows.length
    setPrevious(active)
    setMotion(!keyboard)
    setActive(next)
    const tab = tabs.current[next]
    const rail = tab?.parentElement
    if (rail && tab) {
      const bounds = tab.getBoundingClientRect()
      const left = bounds.left - rail.getBoundingClientRect().left + rail.scrollLeft
      if (left < rail.scrollLeft) rail.scrollLeft = Math.floor(left)
      else if (left + bounds.width > rail.scrollLeft + rail.clientWidth)
        rail.scrollLeft = Math.ceil(left + bounds.width - rail.clientWidth)
    }
    if (keyboard) tab?.focus()
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const positions: Partial<Record<string, number>> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: workflows.length - 1,
    }
    const next = positions[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(next, true)
  }

  if (!workflows.length) return null
  return (
    <div className="workflow-carousel" data-motion={motion}>
      <div className="workflow-navigation">
        <div role="tablist" aria-label={label} className="workflow-tabs">
          {workflows.map((item, index) => (
            <Button
              key={item.key}
              ref={(element) => {
                tabs.current[index] = element
              }}
              id={`${id}-tab-${item.key}`}
              role="tab"
              aria-selected={active === index}
              aria-controls={`${id}-panel-${item.key}`}
              tabIndex={active === index ? 0 : -1}
              variant="ghost"
              size="xl"
              className="workflow-tab"
              onClick={() => select(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        {workflows.length > 8 && (
          <div className="workflow-arrows">
            <IconButton
              size="sm"
              aria-label={`Previous: ${label}`}
              onClick={() => select(active - 1)}
            >
              <ChevronLeft />
            </IconButton>
            <span className="text-xs text-text-faint" aria-live="polite">
              {active + 1} / {workflows.length}
            </span>
            <IconButton size="sm" aria-label={`Next: ${label}`} onClick={() => select(active + 1)}>
              <ChevronRight />
            </IconButton>
          </div>
        )}
      </div>
      <div className="workflow-panels">
        {workflows.map((item, index) => (
          <div
            key={item.key}
            id={`${id}-panel-${item.key}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${item.key}`}
            aria-hidden={active !== index || undefined}
            inert={active !== index}
            data-active={active === index}
            className="workflow-panel"
          >
            <WorkflowContent
              item={item}
              src={index === active || index === previous ? shots[item.shot]!.src : undefined}
            />
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-text-faint">
        {workflows[active]?.key === 'plugins'
          ? 'Plugins run unsandboxed in the Localix process. Install code you trust.'
          : 'Select a view. Tap the screenshot to explore the details.'}
      </p>
    </div>
  )
}
