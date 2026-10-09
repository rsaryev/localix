import { ArrowLeft, ArrowRight, Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { SelectionTile } from '@localixai/kit/selection-tile'
import { FilmCanvas } from './FilmCanvas'
import { sceneSchema, type MotionDocument, type MotionScene } from '../shared/schema'

export function SceneStrip({
  document,
  scene,
  onSelect,
  onChange,
}: {
  document: MotionDocument
  scene: MotionScene
  onSelect: (scene: MotionScene, document?: MotionDocument) => void
  onChange: (document: MotionDocument) => void
}) {
  const index = document.scenes.indexOf(scene)
  const patch = (scenes: MotionScene[]) => onChange({ ...document, scenes })
  const move = (direction: number) => {
    const scenes = [...document.scenes]
    const destination = index + direction
    if (destination < 0 || destination >= scenes.length) return
    ;[scenes[index], scenes[destination]] = [scenes[destination]!, scenes[index]!]
    patch(scenes)
  }
  return (
    <section aria-label="Storyboard" className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-soft">Scenes</span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={document.scenes.length >= 30}
            onClick={() => {
              const next = sceneSchema.parse({
                id: crypto.randomUUID(),
                layout: 'title',
                headline: 'A new chapter.',
              })
              const scenes = [...document.scenes, next]
              patch(scenes)
              onSelect(next, { ...document, scenes })
            }}
          >
            <Plus />
            Add scene
          </Button>
          <IconButton
            size="xs"
            tooltip="Move scene earlier"
            aria-label="Move scene earlier"
            disabled={index === 0}
            onClick={() => move(-1)}
          >
            <ArrowLeft />
          </IconButton>
          <IconButton
            size="xs"
            tooltip="Move scene later"
            aria-label="Move scene later"
            disabled={index === document.scenes.length - 1}
            onClick={() => move(1)}
          >
            <ArrowRight />
          </IconButton>
          <IconButton
            size="xs"
            tooltip="Duplicate scene"
            aria-label="Duplicate scene"
            disabled={document.scenes.length >= 30}
            onClick={() => {
              const next = {
                ...scene,
                id: crypto.randomUUID(),
                layers: scene.layers.map((layer) => ({ ...layer, id: crypto.randomUUID() })),
              }
              const scenes = [...document.scenes]
              scenes.splice(index + 1, 0, next)
              patch(scenes)
              onSelect(next, { ...document, scenes })
            }}
          >
            <Copy />
          </IconButton>
          <IconButton
            size="xs"
            tooltip="Remove scene"
            aria-label="Remove scene"
            disabled={document.scenes.length === 1}
            onClick={() => patch(document.scenes.filter((item) => item.id !== scene.id))}
          >
            <Trash2 />
          </IconButton>
        </div>
      </div>
      <div role="group" aria-label="Video scenes" className="flex gap-2 overflow-x-auto pb-1">
        {document.scenes.map((item, i) => (
          <SelectionTile
            key={item.id}
            selected={item.id === scene.id}
            aria-label={`Scene ${i + 1}: ${item.headline || 'Untitled'}`}
            onClick={() => onSelect(item)}
            className="w-32 shrink-0"
          >
            <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm bg-foreground/[0.04]">
              <div
                className={
                  document.format === 'portrait' ? 'h-full w-auto aspect-[9/16]' : 'w-full'
                }
              >
                <FilmCanvas
                  document={{ ...document, scenes: [item] }}
                  frame={Math.round(Math.min(1.2, item.duration / 2) * document.fps)}
                  thumbnail
                />
              </div>
            </div>
            <span className="mt-1 flex w-full justify-between text-2xs text-text-soft">
              <span>{String(i + 1).padStart(2, '0')}</span>
              <span className="tabular-nums">{item.duration}s</span>
            </span>
            <span className="mt-0.5 w-full truncate text-2xs">
              {item.headline || 'Untitled scene'}
            </span>
          </SelectionTile>
        ))}
      </div>
    </section>
  )
}
