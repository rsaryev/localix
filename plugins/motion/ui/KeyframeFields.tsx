import type { Keyframe } from '../shared/schema'
import { NumberField } from './NumberField'
export function KeyframeFields({
  frame: key,
  duration,
  onChange,
}: {
  frame: Keyframe
  duration: number
  onChange: (patch: Partial<Keyframe>) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField
        label="Keyframe time (s)"
        value={key.time}
        min={0}
        max={duration}
        step={0.1}
        onChange={(time) => onChange({ time })}
      />
      <NumberField
        label="Opacity (%)"
        value={key.opacity * 100}
        min={0}
        max={100}
        onChange={(value) => onChange({ opacity: value / 100 })}
      />
      <NumberField
        label="Position X (%)"
        value={key.x * 100}
        min={-200}
        max={300}
        onChange={(value) => onChange({ x: value / 100 })}
      />
      <NumberField
        label="Position Y (%)"
        value={key.y * 100}
        min={-200}
        max={300}
        onChange={(value) => onChange({ y: value / 100 })}
      />
      <NumberField
        label="Scale (%)"
        value={key.scale * 100}
        min={0}
        max={1000}
        onChange={(value) => onChange({ scale: value / 100 })}
      />
      <NumberField
        label="Rotation (degrees)"
        value={key.rotation}
        min={-720}
        max={720}
        onChange={(rotation) => onChange({ rotation })}
      />
    </div>
  )
}
