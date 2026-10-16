import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import type { ResumeDocument } from '../shared/schema'
import { TextField } from './TextField'
import { PortraitEditor } from './PortraitEditor'

export function HeaderEditor({
  document,
  onChange,
  identityOnly = false,
}: {
  document: ResumeDocument
  onChange: (document: ResumeDocument) => void
  identityOnly?: boolean
}) {
  const header = document.header
  const set = (key: keyof typeof header, value: unknown) =>
    onChange({ ...document, header: { ...header, [key]: value } })
  return (
    <div className="space-y-6">
      {!identityOnly && (
        <TextField
          field="title"
          label="Resume title"
          value={document.title}
          onChange={(title) => onChange({ ...document, title })}
        />
      )}
      <section className="space-y-4" aria-label="Identity and contact information">
        <h2 className="text-sm font-medium text-text-strong">Identity & contact</h2>
        <TextField
          field="header.name"
          label="Full name"
          value={header.name}
          onChange={(value) => set('name', value)}
        />
        <TextField
          field="header.headline"
          label="Professional headline"
          value={header.headline}
          onChange={(value) => set('headline', value)}
        />
        <div className="grid gap-4 @xl:grid-cols-2">
          {(['email', 'phone', 'location'] as const).map((key) => (
            <TextField
              key={key}
              field={`header.${key}`}
              label={{ email: 'Email', phone: 'Phone', location: 'Location' }[key]}
              value={header[key]}
              onChange={(value) => set(key, value)}
            />
          ))}
        </div>
        {header.links.map((link, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="grid min-w-0 flex-1 gap-2 @xl:grid-cols-2">
              <TextField
                field={`header.links.${index}.label`}
                label={`Link ${index + 1} label`}
                value={link.label}
                onChange={(label) =>
                  set(
                    'links',
                    header.links.map((item, i) => (i === index ? { ...item, label } : item)),
                  )
                }
              />
              <TextField
                field={`header.links.${index}.url`}
                label={`Link ${index + 1} URL`}
                value={link.url}
                maxLength={2_000}
                placeholder="https://example.com"
                onChange={(url) =>
                  set(
                    'links',
                    header.links.map((item, i) => (i === index ? { ...item, url } : item)),
                  )
                }
              />
            </div>
            <IconButton
              aria-label={`Remove link ${index + 1}`}
              onClick={() =>
                set(
                  'links',
                  header.links.filter((_, i) => i !== index),
                )
              }
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          disabled={header.links.length >= 12}
          onClick={() => set('links', [...header.links, { label: '', url: '' }])}
        >
          <Plus data-icon="inline-start" />
          Add link
        </Button>
      </section>
      <PortraitEditor document={document} onChange={onChange} />
      {!identityOnly && (
        <section className="space-y-4 border-t border-border pt-5" aria-label="Role context">
          <h2 className="text-sm font-medium text-text-strong">Role context</h2>
          <p className="text-xs text-text-soft">
            Shared with the agent for tailoring. These notes stay out of the exported resume.
          </p>
          <TextField
            field="targetRole"
            label="Target role"
            value={document.targetRole}
            onChange={(targetRole) => onChange({ ...document, targetRole })}
          />
          <TextField
            field="jobDescription"
            label="Job description"
            value={document.jobDescription}
            multiline
            maxLength={16_000}
            onChange={(jobDescription) => onChange({ ...document, jobDescription })}
          />
        </section>
      )}
    </div>
  )
}
