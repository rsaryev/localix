import { useState } from 'react'
import { SelectionTile } from '@localixai/kit/selection-tile'
import { FilmCanvas } from './FilmCanvas'
import { ChoiceMenu } from './ChoiceMenu'
import { templateIds, type TemplateId } from '../shared/schema'
import { createTemplateDocument, templates } from '../shared/templates'
import { durationOf } from '../shared/timing'

const ids = templateIds.filter((id) => id !== 'blank')
export const samples = Object.fromEntries(ids.map((id) => [id, createTemplateDocument(id)]))
const previewFrames: Partial<Record<TemplateId, number>> = {
  relay: 150,
  explainer: 150,
  report: 180,
  launch: 81,
  social: 180,
  identity: 162,
  editorial: 180,
}
export function TemplateGallery({
  onChoose,
  disabled,
}: {
  onChoose: (id: TemplateId, trigger: HTMLButtonElement) => void
  disabled: boolean
}) {
  const [category, setCategory] = useState('All directions')
  const [previewed, setPreviewed] = useState<TemplateId | null>(null)
  return (
    <div className="space-y-3">
      <ChoiceMenu
        label={category}
        entries={['All directions', ...new Set(ids.map((id) => templates[id].category))].map(
          (value) => ({
            id: value,
            label: value,
            selected: value === category,
            onSelect: () => setCategory(value),
          }),
        )}
      />
      <div
        role="group"
        aria-label="Motion templates"
        className="grid grid-cols-1 gap-2 @lg/motion-creation:grid-cols-2 @2xl/motion-creation:grid-cols-3 @4xl/motion-creation:grid-cols-4 @6xl/motion-creation:grid-cols-5 @7xl/motion-creation:grid-cols-6"
      >
        {ids
          .filter((id) => category === 'All directions' || templates[id].category === category)
          .map((id) => (
            <SelectionTile
              key={id}
              selected={previewed === id}
              onClick={(event) => {
                setPreviewed(id)
                onChoose(id, event.currentTarget)
              }}
              disabled={disabled}
              aria-label={`Preview ${templates[id].name} template`}
            >
              <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-sm bg-foreground/[0.04]">
                <div
                  className={
                    samples[id]!.format === 'portrait'
                      ? 'h-full w-auto aspect-[9/16]'
                      : 'h-full w-auto max-w-full aspect-video'
                  }
                >
                  <FilmCanvas document={samples[id]!} frame={previewFrames[id] ?? 36} thumbnail />
                </div>
              </div>
              <span className="mt-1.5 w-full truncate font-medium text-foreground">
                {templates[id].name}
              </span>
              <span className="mt-0.5 flex w-full items-baseline justify-between gap-2">
                <span className="truncate text-2xs text-text-soft">{templates[id].category}</span>
                <span className="text-2xs text-text-faint">{durationOf(samples[id]!)}s</span>
              </span>
            </SelectionTile>
          ))}
      </div>
    </div>
  )
}
