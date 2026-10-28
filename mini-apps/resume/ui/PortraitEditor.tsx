import { useLayoutEffect, useRef, useState } from 'react'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Button } from '@localixai/kit/button'
import type { ResumeDocument } from '../shared/schema'
import { ChoiceMenu } from './ChoiceMenu'

async function portrait(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 10_000_000)
    throw new Error('Choose a PNG or JPEG image under 10 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error('This image is too large. Resize it and retry.')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 192
    const context = canvas.getContext('2d')!
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      192,
      192,
    )
    return canvas.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
}
export function PortraitEditor({
  document,
  onChange,
}: {
  document: ResumeDocument
  onChange: (document: ResumeDocument) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const latest = useRef({ document, onChange })
  // The picked image resolves later than the render that started it; it applies to the latest props.
  useLayoutEffect(() => {
    latest.current = { document, onChange }
  })
  const load = async (file: File) => {
    setLoading(true)
    try {
      const photo = await portrait(file)
      const current = latest.current
      current.onChange({
        ...current.document,
        header: { ...current.document.header, photo },
      })
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read this image.')
    } finally {
      setLoading(false)
    }
  }
  const p = document.presentation
  const set = (value: Partial<typeof p>) =>
    onChange({ ...document, presentation: { ...p, ...value } })
  return (
    <section aria-label="Resume portrait" className="space-y-4 border-t border-border pt-5">
      <h2 className="text-sm font-medium text-text-strong">Photo</h2>
      <Field
        label="Optional portrait"
        description="Cropped to a square and stored in this resume. Included in PDF and Word exports."
      >
        <Input
          type="file"
          accept="image/png,image/jpeg"
          disabled={loading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void load(file)
          }}
        />
      </Field>
      {error && (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      )}
      {document.header.photo && (
        <>
          <img src={document.header.photo} alt="Resume portrait" className="size-16 object-cover" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Photo size (px)">
              <Input
                type="number"
                min={40}
                max={96}
                value={p.photoSize ?? 56}
                onChange={(event) => {
                  const value = event.target.valueAsNumber
                  if (value >= 40 && value <= 96) set({ photoSize: value })
                }}
              />
            </Field>
            <Field label="Corner radius (%)">
              <Input
                type="number"
                min={0}
                max={50}
                value={p.photoRadius ?? 0}
                onChange={(event) => {
                  const value = event.target.valueAsNumber
                  if (value >= 0 && value <= 50) set({ photoRadius: value })
                }}
              />
            </Field>
          </div>
          <Field label="Photo alignment">
            <ChoiceMenu
              label={p.photoAlign ?? 'top'}
              entries={(['top', 'center', 'bottom'] as const).map((align) => ({
                id: align,
                label: align[0].toUpperCase() + align.slice(1),
                selected: (p.photoAlign ?? 'top') === align,
                onSelect: () => set({ photoAlign: align }),
              }))}
            />
          </Field>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...document, header: { ...document.header, photo: null } })}
          >
            Remove photo
          </Button>
        </>
      )}
    </section>
  )
}
