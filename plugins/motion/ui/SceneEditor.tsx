import { useEffect, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import { ChoiceMenu } from './ChoiceMenu'
import {
  layouts,
  paletteIds,
  sceneSchema,
  type MotionAsset,
  type MotionScene,
} from '../shared/schema'
import { NumberField } from './NumberField'
import { LayerEditor } from './LayerEditor'
import { DataSeriesFields } from './DataSeriesFields'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'

function LayersEditor({
  scene,
  onChange,
}: {
  scene: MotionScene
  onChange: (scene: MotionScene) => void
}) {
  const [text, setText] = useState(JSON.stringify(scene.layers, null, 2))
  const [error, setError] = useState('')
  useEffect(() => {
    setText(JSON.stringify(scene.layers, null, 2))
    setError('')
  }, [scene.layers])
  return (
    <CollapsibleSection title="Layer JSON" defaultOpen={false}>
      <Field
        label="Keyframed layers"
        description="Optional JSON layers for custom compositions. Ask the agent to author them; apply to preview."
        error={error || undefined}
      >
        <Textarea
          value={text}
          rows={6}
          maxLength={80000}
          className="font-mono text-xs"
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          try {
            const parsed = sceneSchema.safeParse({ ...scene, layers: JSON.parse(text) })
            if (
              !parsed.success ||
              parsed.data.layers.some((layer) =>
                layer.keyframes.some((key) => key.time > scene.duration),
              )
            )
              throw new Error('Check layer fields, increasing keyframe times and scene duration.')
            onChange(parsed.data)
            setError('')
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Check the layer JSON.')
          }
        }}
      >
        Apply layers
      </Button>
    </CollapsibleSection>
  )
}
export function SceneEditor({
  scene,
  assets,
  onChange,
  onUpload,
  disabled,
}: {
  scene: MotionScene
  assets: MotionAsset[]
  onChange: (scene: MotionScene) => void
  onUpload: (file: File) => Promise<MotionAsset | null>
  disabled: boolean
}) {
  const set = (patch: Partial<MotionScene>) => onChange({ ...scene, ...patch })
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <legend className="mb-3 text-sm font-medium text-foreground">Scene settings</legend>
      <div className="flex flex-wrap gap-2">
        <ChoiceMenu
          label={`Layout: ${scene.layout}`}
          disabled={disabled}
          entries={layouts.map((layout) => ({
            id: layout,
            label: layout[0]!.toUpperCase() + layout.slice(1),
            selected: scene.layout === layout,
            onSelect: () => set({ layout }),
          }))}
        />
        <ChoiceMenu
          label={`Transition: ${scene.transition}`}
          disabled={disabled}
          entries={(['cut', 'fade', 'wipe'] as const).map((transition) => ({
            id: transition,
            label: transition[0]!.toUpperCase() + transition.slice(1),
            selected: scene.transition === transition,
            onSelect: () => set({ transition }),
          }))}
        />
      </div>
      {scene.layout !== 'custom' && (
        <>
          <Field label="Headline">
            <Textarea
              rows={2}
              maxLength={180}
              value={scene.headline}
              onChange={(event) => set({ headline: event.target.value })}
            />
          </Field>
          <Field label="Supporting text">
            <Textarea
              rows={2}
              maxLength={600}
              value={scene.body}
              onChange={(event) => set({ body: event.target.value })}
            />
          </Field>
          <Field label="Label">
            <Input
              maxLength={80}
              value={scene.label}
              onChange={(event) => set({ label: event.target.value })}
            />
          </Field>
        </>
      )}
      <NumberField
        label="Duration (seconds)"
        value={scene.duration}
        min={1}
        max={20}
        step={0.5}
        onChange={(duration) => set({ duration })}
      />
      {(scene.layout === 'cards' || scene.layout === 'steps' || scene.layout === 'focus') && (
        <Field label="Items" description="One item per line, up to six.">
          <Textarea
            rows={4}
            value={scene.items.join('\n')}
            maxLength={606}
            onChange={(event) =>
              set({
                items: event.target.value
                  .split('\n')
                  .slice(0, 6)
                  .map((item) => item.slice(0, 100)),
              })
            }
          />
        </Field>
      )}
      {(scene.layout === 'stat' || scene.layout === 'bars') && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Value"
            value={scene.value}
            min={-1e9}
            max={1e9}
            step={0.1}
            onChange={(value) => set({ value })}
          />
          <Field label="Suffix">
            <Input
              maxLength={20}
              value={scene.suffix}
              onChange={(event) => set({ suffix: event.target.value })}
            />
          </Field>
        </div>
      )}
      {scene.layout === 'bars' && <DataSeriesFields scene={scene} onChange={onChange} />}
      {scene.layout === 'product' && (
        <div className="space-y-2">
          <ChoiceMenu
            label={
              scene.imageId
                ? `Image: ${assets.find((asset) => asset.id === scene.imageId)?.name ?? 'Missing image'}`
                : 'Image: illustrative composition'
            }
            disabled={disabled}
            entries={[
              {
                id: 'none',
                label: 'Illustrative composition',
                selected: !scene.imageId,
                onSelect: () => set({ imageId: null }),
              },
              ...assets
                .filter((asset) => asset.kind === 'image')
                .map((asset) => ({
                  id: asset.id,
                  label: asset.name,
                  selected: scene.imageId === asset.id,
                  onSelect: () => set({ imageId: asset.id }),
                })),
            ]}
          />
          <Field label="Upload product image" description="PNG, JPEG or WebP, up to 25 MiB.">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file)
                  void onUpload(file).then((asset) => {
                    if (asset) set({ imageId: asset.id })
                  })
                event.target.value = ''
              }}
            />
          </Field>
        </div>
      )}
      <ChoiceMenu
        label={`Scene palette: ${scene.palette ?? 'video default'}`}
        disabled={disabled}
        entries={[
          {
            id: 'default',
            label: 'Video default',
            selected: scene.palette === null,
            onSelect: () => set({ palette: null }),
          },
          ...paletteIds.map((palette) => ({
            id: palette,
            label: palette[0]!.toUpperCase() + palette.slice(1),
            selected: scene.palette === palette,
            onSelect: () => set({ palette }),
          })),
        ]}
      />
      <CollapsibleSection
        title="Advanced motion"
        count={scene.layers.length}
        defaultOpen={scene.layout === 'custom'}
      >
        <LayerEditor
          scene={scene}
          assets={assets}
          onChange={onChange}
          onUpload={onUpload}
          disabled={disabled}
        />
        <LayersEditor key={scene.id} scene={scene} onChange={onChange} />
      </CollapsibleSection>
    </fieldset>
  )
}
