import { Check } from 'lucide-react'
import { SelectionTile } from '@localixai/kit/selection-tile'
import { DocumentThumbnail } from '@localixai/kit/document-thumbnail'
import { templates, type TemplateId } from '../shared/templates'
import { createSampleDocument } from '../shared/sample'
import { Preview } from './Preview'

const order: TemplateId[] = ['awal', 'ketat', 'ketik', 'klasik', 'luasa', 'tebal']
const samples = Object.fromEntries(
  order.map((id) => [id, createSampleDocument(id, 'Sample resume')]),
)
export function TemplateGallery({
  value,
  onChange,
  disabled = false,
}: {
  value: TemplateId
  onChange: (template: TemplateId) => void
  disabled?: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Resume templates"
      className="grid grid-cols-2 gap-3 @2xl:grid-cols-3"
    >
      {order.map((id) => (
        <SelectionTile
          key={id}
          selected={id === value}
          disabled={disabled}
          aria-label={`${templates[id].name} template`}
          onClick={() => onChange(id)}
        >
          <div className="relative h-40 w-full overflow-hidden bg-surface-hover p-3">
            <DocumentThumbnail className="rounded-sm">
              <Preview document={samples[id]!} />
            </DocumentThumbnail>
            {value === id && (
              <span className="absolute right-2 top-2 rounded-full bg-foreground p-1 text-background-solid">
                <Check className="size-3.5" />
              </span>
            )}
          </div>
          <span className="mt-2 flex items-baseline justify-between gap-2 font-medium">
            <span>{templates[id].name}</span>
            <span className="sr-only">{templates[id].description}</span>
          </span>
        </SelectionTile>
      ))}
    </div>
  )
}
