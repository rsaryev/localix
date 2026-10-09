import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import { ChoiceMenu } from './ChoiceMenu'
import { NumberField } from './NumberField'
import type { MotionDocument, MotionAsset } from '../shared/schema'

export function MediaSettings({
  document,
  assets,
  disabled,
  onChange,
  onUpload,
}: {
  document: MotionDocument
  assets: MotionAsset[]
  disabled: boolean
  onChange: (patch: Partial<MotionDocument>) => void
  onUpload: (file: File) => Promise<MotionAsset | null>
}) {
  return (
    <div className="space-y-4">
      <Field
        label="Creative brief"
        description="Audience, message, style and sources. Shared with the agent; excluded from the video."
      >
        <Textarea
          rows={3}
          maxLength={4000}
          value={document.brief}
          onChange={(event) => onChange({ brief: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <ChoiceMenu
          label={
            document.soundtrackId
              ? `Audio: ${assets.find((asset) => asset.id === document.soundtrackId)?.name ?? 'Missing soundtrack'}`
              : 'Audio: none'
          }
          entries={[
            {
              id: 'none',
              label: 'No soundtrack',
              selected: !document.soundtrackId,
              onSelect: () => onChange({ soundtrackId: null }),
            },
            ...assets
              .filter((asset) => asset.kind === 'audio')
              .map((asset) => ({
                id: asset.id,
                label: asset.name,
                selected: document.soundtrackId === asset.id,
                onSelect: () => onChange({ soundtrackId: asset.id }),
              })),
          ]}
        />
      </div>
      <Field
        label="Upload soundtrack"
        description="MP3, WAV or Ogg, up to 25 MiB. Audio fades in and out at the film boundaries."
      >
        <Input
          type="file"
          accept="audio/mpeg,audio/wav,audio/ogg"
          disabled={disabled}
          onChange={(event) => {
            void (async () => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                const asset = await onUpload(file)
                if (asset) onChange({ soundtrackId: asset.id })
              }
            })()
          }}
        />
      </Field>
      {document.soundtrackId && (
        <NumberField
          label="Soundtrack volume"
          value={document.volume}
          min={0}
          max={1}
          step={0.1}
          onChange={(volume) => onChange({ volume })}
        />
      )}
    </div>
  )
}
