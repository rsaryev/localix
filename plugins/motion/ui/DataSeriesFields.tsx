import { Plus, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { NumberField } from './NumberField'
import type { MotionScene } from '../shared/schema'

export function DataSeriesFields({
  scene,
  onChange,
}: {
  scene: MotionScene
  onChange: (scene: MotionScene) => void
}) {
  return (
    <div className="space-y-3">
      {scene.series.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label={`Bar ${i + 1} label`}>
            <Input
              value={item.label}
              maxLength={40}
              onChange={(event) =>
                onChange({
                  ...scene,
                  series: scene.series.map((row, index) =>
                    index === i ? { ...row, label: event.target.value } : row,
                  ),
                })
              }
            />
          </Field>
          <NumberField
            label={`Bar ${i + 1} value`}
            value={item.value}
            min={0}
            max={1e9}
            onChange={(value) =>
              onChange({
                ...scene,
                series: scene.series.map((row, index) => (index === i ? { ...row, value } : row)),
              })
            }
          />
          <IconButton
            size="sm"
            tooltip={`Remove bar ${i + 1}`}
            aria-label={`Remove bar ${i + 1}`}
            onClick={() =>
              onChange({ ...scene, series: scene.series.filter((_, index) => i !== index) })
            }
          >
            <X />
          </IconButton>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        disabled={scene.series.length >= 6}
        onClick={() =>
          onChange({ ...scene, series: [...scene.series, { label: 'Label', value: 1 }] })
        }
      >
        <Plus />
        Add bar
      </Button>
    </div>
  )
}
