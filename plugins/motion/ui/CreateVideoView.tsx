import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { TemplateGallery, samples } from './TemplateGallery'
import { Playback } from './Playback'
import { templates } from '../shared/templates'
import { Input } from '@localixai/kit/input'
import { Field } from '@localixai/kit/field'
import { documentSchema, type MotionDocument, type TemplateId } from '../shared/schema'

export function CreateVideoView({
  active,
  disabled,
  onClose,
  onCreate,
  onImport,
  failure,
}: {
  failure?: string | null
  active: boolean
  disabled: boolean
  onClose: () => void
  onCreate: (template: TemplateId) => Promise<boolean>
  onImport: (document: MotionDocument) => Promise<boolean>
}) {
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<TemplateId | null>(null)
  const [frame, setFrame] = useState(36)
  const body = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const importTrigger = useRef<HTMLButtonElement>(null)
  const galleryScroll = useRef(0)
  const region = useRef<HTMLElement>(null)
  const rememberChooser = (trigger: HTMLButtonElement) => {
    returnFocus.current = trigger
    galleryScroll.current = body.current?.scrollTop ?? 0
  }
  const back = () => {
    setSelected(null)
    setImporting(false)
    setError('')
  }
  const dismiss = () => {
    if (disabled) return
    if (selected || importing) back()
    else onClose()
  }
  useEffect(() => {
    const element = region.current
    if (!active || !element) return
    const navigateBack = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || disabled) return
      event.preventDefault()
      event.stopPropagation()
      if (selected || importing) {
        setSelected(null)
        setImporting(false)
        setError('')
      } else onClose()
    }
    element.addEventListener('keydown', navigateBack)
    return () => element.removeEventListener('keydown', navigateBack)
  }, [active, disabled, selected, importing, onClose])
  useLayoutEffect(() => {
    if (selected || importing) {
      if (body.current) body.current.scrollTop = 0
      heading.current?.focus({ preventScroll: true })
    } else if (returnFocus.current) {
      if (body.current) body.current.scrollTop = galleryScroll.current
      const trigger = returnFocus.current.isConnected ? returnFocus.current : importTrigger.current
      trigger?.focus({ preventScroll: true })
      if (trigger && body.current?.contains(trigger)) {
        const region = body.current.getBoundingClientRect()
        const tile = trigger.getBoundingClientRect()
        if (tile.top < region.top || tile.bottom > region.bottom)
          trigger.scrollIntoView({ block: 'nearest' })
      }
    } else heading.current?.focus({ preventScroll: true })
  }, [selected, importing])
  const create = (id: TemplateId) =>
    void onCreate(id).then((created) => {
      if (created) onClose()
    })
  return (
    <section
      ref={region}
      aria-label="Video creation"
      className="@container/motion-creation flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <WorkbenchToolbar
        as="header"
        aria-label="Video creation navigation"
        wrap
        className="justify-between"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Button size="sm" variant="ghost" disabled={disabled} onClick={dismiss}>
            <ArrowLeft />
            {selected || importing ? 'Back to templates' : 'Projects'}
          </Button>
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-sm font-medium text-foreground outline-none"
          >
            {importing ? 'Import project' : selected ? templates[selected].name : 'Create video'}
          </h1>
        </div>
        {selected ? (
          <Button size="sm" disabled={disabled} onClick={() => create(selected)}>
            {disabled ? 'Creating…' : 'Use template'}
          </Button>
        ) : !importing ? (
          <div className="flex items-center gap-2">
            <Button
              ref={importTrigger}
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={(event) => {
                rememberChooser(event.currentTarget)
                setImporting(true)
              }}
            >
              Import JSON
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => create('blank')}>
              <Plus />
              Start from scratch
            </Button>
          </div>
        ) : null}
      </WorkbenchToolbar>
      <div
        ref={body}
        data-slot="motion-creation-body"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 @2xl/motion-creation:px-6"
      >
        <div hidden={importing || selected !== null}>
          <p className="mb-4 text-xs text-text-soft">
            Choose a direction, or start with a blank canvas.
          </p>
          <TemplateGallery
            disabled={disabled}
            onChoose={(id, trigger) => {
              rememberChooser(trigger)
              setFrame(36)
              setSelected(id)
            }}
          />
        </div>
        {importing ? (
          <Field
            label="Project JSON"
            description="Import a .motion.json file. Upload referenced media separately."
            error={error || undefined}
          >
            <Input
              type="file"
              accept="application/json,.json"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void (async () => {
                  try {
                    if (file.size > 1024 * 1024)
                      throw new Error('Choose a project JSON under 1 MiB.')
                    const document = documentSchema.parse(JSON.parse(await file.text()))
                    if (await onImport(document)) onClose()
                  } catch {
                    setError(
                      'This is not a valid Motion Studio project. Check its fields and duration.',
                    )
                  }
                })()
              }}
            />
          </Field>
        ) : selected ? (
          <div className="w-full space-y-4">
            <p className="text-xs text-text-soft">{templates[selected].description}</p>
            <Playback
              document={samples[selected]!}
              frame={frame}
              onFrame={setFrame}
              active={active}
            />
          </div>
        ) : null}
        {failure && (
          <p role="alert" className="mt-3 text-xs text-status-error">
            {failure}
          </p>
        )}
      </div>
    </section>
  )
}
