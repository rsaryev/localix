import { documentFonts, documentFontIds } from '@localixai/mini-app-sdk/document-layout'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Checkbox } from '@localixai/kit/checkbox'
import type { ResumeDocument } from '../shared/schema'
import { ChoiceMenu } from './ChoiceMenu'
import { sectionLabels } from '../shared/presentation'

const numeric = [
  ['nameScale', 'Name and headline size', 0.8, 1.2, 0.05, 1],
  ['titleScale', 'Section heading size', 0.8, 1.2, 0.05, 1],
  ['bodyScale', 'Body text size', 0.8, 1.2, 0.05, 1],
  ['lineHeight', 'Line height', 1.2, 2, 0.05, 1.4],
  ['letterSpacing', 'Letter spacing (pt)', -0.5, 0.5, 0.05, 0],
  ['sectionSpacing', 'Additional section spacing (pt)', -24, 60, 1, 0],
] as const
export function PresentationEditor({
  document,
  onChange,
}: {
  document: ResumeDocument
  onChange: (document: ResumeDocument) => void
}) {
  const p = document.presentation
  const set = (value: Partial<typeof p>) =>
    onChange({ ...document, presentation: { ...p, ...value } })
  return (
    <div className="space-y-6">
      <section aria-label="Resume typography" className="space-y-4">
        <h2 className="text-sm font-medium text-text-strong">Typography</h2>
        <Field label="Document font">
          <ChoiceMenu
            label={p.font ? documentFonts[p.font] : 'Template default'}
            entries={[
              {
                id: 'default',
                label: 'Template default',
                selected: !p.font,
                onSelect: () => set({ font: undefined }),
              },
              ...documentFontIds.map((id) => ({
                id,
                label: documentFonts[id],
                selected: p.font === id,
                onSelect: () => set({ font: id }),
              })),
            ]}
          />
        </Field>
        <div className="grid gap-4 @xl:grid-cols-2">
          {numeric.map(([key, label, min, max, step, fallback]) => (
            <Field
              key={key}
              label={label}
              description={key.endsWith('Scale') ? '1 is the template size.' : undefined}
            >
              <Input
                type="number"
                value={p[key] ?? fallback}
                min={min}
                max={max}
                step={step}
                onChange={(event) => {
                  const value = event.target.valueAsNumber
                  if (Number.isFinite(value) && value >= min && value <= max) set({ [key]: value })
                }}
              />
            </Field>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange({
              ...document,
              presentation: {
                template: p.template,
                language: p.language,
                showIcons: p.showIcons,
                photoSize: p.photoSize,
                photoRadius: p.photoRadius,
                photoAlign: p.photoAlign,
              },
            })
          }
        >
          Reset typography
        </Button>
      </section>
      <section aria-label="Resume document language" className="space-y-4">
        <h2 className="text-sm font-medium text-text-strong">Document labels</h2>
        <Field
          label="Language"
          description="Updates default section headings and the ongoing date label. Your custom headings and content are preserved."
        >
          <ChoiceMenu
            label={p.language === 'id' ? 'Indonesian' : 'English'}
            entries={(['en', 'id'] as const).map((language) => ({
              id: language,
              label: language === 'en' ? 'English' : 'Indonesian',
              selected: (p.language ?? 'en') === language,
              onSelect: () =>
                onChange({
                  ...document,
                  presentation: { ...p, language },
                  sections: document.sections.map((section) => ({
                    ...section,
                    title:
                      section.title === sectionLabels[p.language ?? 'en'][section.type]
                        ? sectionLabels[language][section.type]
                        : section.title,
                  })),
                }),
            }))}
          />
        </Field>
        <Field label="Show contact icons" layout="inline">
          <Checkbox
            checked={p.showIcons ?? true}
            onChange={(event) => set({ showIcons: event.target.checked })}
          />
        </Field>
      </section>
    </div>
  )
}
