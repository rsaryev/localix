import { KeyframeFields } from './KeyframeFields'
import { motionPresets, presetKeyframes } from '../shared/motion-presets'
import { useState } from 'react'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Plus, Trash2 } from 'lucide-react'
import { ChoiceMenu } from './ChoiceMenu'
import { NumberField } from './NumberField'
import {
  layerSchema,
  type Keyframe,
  type MotionAsset,
  type MotionLayer,
  type MotionScene,
} from '../shared/schema'

export function LayerEditor({
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
  const [selected, setSelected] = useState(scene.layers[0]?.id ?? '')
  const [keyIndex, setKeyIndex] = useState(0)
  const [error, setError] = useState('')
  const layer = scene.layers.find((layer) => layer.id === selected) ?? scene.layers[0]
  const index = layer ? Math.min(keyIndex, layer.keyframes.length - 1) : 0
  const key = layer?.keyframes[index]
  const changeLayer = (patch: Partial<MotionLayer>) => {
    if (!layer) return
    const parsed = layerSchema.safeParse({ ...layer, ...patch })
    if (!parsed.success || parsed.data.keyframes.some((frame) => frame.time > scene.duration)) {
      setError('Keep keyframes at different times inside the scene and check the layer values.')
      return
    }
    setError('')
    onChange({
      ...scene,
      layers: scene.layers.map((item) => (item.id === layer.id ? parsed.data : item)),
    })
  }
  const changeKey = (patch: Partial<Keyframe>) => {
    if (!layer || !key) return
    const next = { ...key, ...patch }
    const frames = layer.keyframes
      .map((frame, i) => (i === index ? next : frame))
      .sort((a, b) => a.time - b.time)
    changeLayer({ keyframes: frames })
    setKeyIndex(frames.indexOf(next))
  }
  return (
    <div className="space-y-3 pb-3">
      <ChoiceMenu
        disabled={disabled}
        label="Add layer"
        entries={(
          [
            'text',
            'rectangle',
            'circle',
            'ring',
            'rosette',
            'orbit',
            'line',
            'grid',
            'frame',
            'image',
          ] as const
        ).map((kind) => ({
          id: kind,
          label: kind[0]!.toUpperCase() + kind.slice(1),
          disabled: scene.layers.length >= 40,
          onSelect: () => {
            const next = layerSchema.parse({
              id: crypto.randomUUID(),
              kind,
              text: kind === 'text' ? 'Your text' : '',
              color: 'accent',
              width: kind === 'text' ? 0.8 : 0.25,
              height: 0.2,
              keyframes: [
                { time: 0, x: 0.5, y: 0.65, scale: 0.9, opacity: 0 },
                { time: Math.min(0.8, scene.duration), x: 0.5, y: 0.5 },
              ],
            })
            onChange({ ...scene, layers: [...scene.layers, next] })
            setSelected(next.id)
            setKeyIndex(1)
          },
        }))}
      />
      {layer && key && (
        <>
          <ChoiceMenu
            disabled={disabled}
            label={`Layer: ${layer.kind === 'text' ? layer.text || 'Text' : layer.kind}`}
            entries={scene.layers.map((item, i) => ({
              id: item.id,
              label: `${i + 1}. ${item.kind === 'text' ? item.text || 'Text' : item.kind}`,
              selected: item.id === layer.id,
              onSelect: () => {
                setSelected(item.id)
                setKeyIndex(0)
              },
            }))}
          />
          {layer.kind === 'text' && (
            <Field label="Layer text">
              <Input
                value={layer.text}
                maxLength={400}
                onChange={(event) => changeLayer({ text: event.target.value })}
              />
            </Field>
          )}
          {layer.kind === 'image' ? (
            <ChoiceMenu
              disabled={disabled}
              label={`Layer image: ${assets.find((asset) => asset.id === layer.assetId)?.name ?? 'Choose image'}`}
              entries={assets
                .filter((asset) => asset.kind === 'image')
                .map((asset) => ({
                  id: asset.id,
                  label: asset.name,
                  selected: layer.assetId === asset.id,
                  onSelect: () => changeLayer({ assetId: asset.id }),
                }))}
            />
          ) : (
            <ChoiceMenu
              disabled={disabled}
              label={`Layer color: ${layer.color}`}
              entries={(['foreground', 'background', 'accent', 'muted'] as const).map((color) => ({
                id: color,
                label: color[0]!.toUpperCase() + color.slice(1),
                selected: layer.color === color,
                onSelect: () => changeLayer({ color }),
              }))}
            />
          )}
          {layer.kind === 'image' && (
            <Field label="Upload layer image" description="PNG, JPEG or WebP, up to 25 MiB.">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file)
                    void onUpload(file).then((asset) => {
                      if (asset) changeLayer({ assetId: asset.id })
                    })
                }}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Layer width (%)"
              value={layer.width * 100}
              min={1}
              max={200}
              onChange={(value) => changeLayer({ width: value / 100 })}
            />
            <NumberField
              label="Layer height (%)"
              value={layer.height * 100}
              min={1}
              max={200}
              onChange={(value) => changeLayer({ height: value / 100 })}
            />
            {layer.kind === 'text' && (
              <NumberField
                label="Text size (%)"
                value={layer.fontSize * 100}
                min={1}
                max={30}
                onChange={(value) => changeLayer({ fontSize: value / 100 })}
              />
            )}
          </div>
          <ChoiceMenu
            disabled={disabled}
            label="Apply motion preset"
            entries={motionPresets.map((preset) => ({
              id: preset,
              label: preset[0]!.toUpperCase() + preset.slice(1),
              onSelect: () => {
                changeLayer({
                  keyframes: presetKeyframes(preset, scene.duration, layer.keyframes[0]!),
                })
                setKeyIndex(0)
              },
            }))}
          />
          <ChoiceMenu
            disabled={disabled}
            label={`Keyframe: ${key.time}s`}
            entries={layer.keyframes.map((frame, i) => ({
              id: String(i),
              label: `${frame.time}s`,
              selected: index === i,
              onSelect: () => setKeyIndex(i),
            }))}
          />
          <KeyframeFields
            key={`${layer.id}:${index}`}
            frame={key}
            duration={scene.duration}
            onChange={changeKey}
          />
          <ChoiceMenu
            disabled={disabled}
            label={`Easing: ${key.easing}`}
            entries={(['linear', 'smooth', 'out', 'spring'] as const).map((easing) => ({
              id: easing,
              label: { linear: 'Linear', smooth: 'Smooth', out: 'Ease out', spring: 'Spring' }[
                easing
              ],
              selected: key.easing === easing,
              onSelect: () => changeKey({ easing }),
            }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={
                layer.keyframes.length >= 40 || layer.keyframes.at(-1)!.time >= scene.duration
              }
              onClick={() => {
                const last = layer.keyframes.at(-1)!
                changeLayer({
                  keyframes: [
                    ...layer.keyframes,
                    { ...last, time: Math.min(scene.duration, last.time + 0.5) },
                  ],
                })
                setKeyIndex(layer.keyframes.length)
              }}
            >
              <Plus />
              Keyframe
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={layer.keyframes.length <= 1}
              onClick={() =>
                changeLayer({ keyframes: layer.keyframes.filter((_, i) => i !== index) })
              }
            >
              Remove keyframe
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange({ ...scene, layers: scene.layers.filter((item) => item.id !== layer.id) })
              }
            >
              <Trash2 />
              Remove layer
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      )}
    </div>
  )
}
