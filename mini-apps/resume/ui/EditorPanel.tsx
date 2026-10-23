import { useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from 'lucide-react'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { TabStrip, TabPanel, useTabPanelIds } from '@localixai/kit/tabs'
import { emptyEntry, sectionTypes, type ResumeDocument } from '../shared/schema'
import { sectionDefinitions } from '../shared/sections'
import { HeaderEditor } from './HeaderEditor'
import { SectionEditor } from './SectionEditor'
import { TemplateGallery } from './TemplateGallery'
import { TextField } from './TextField'
import { ChoiceMenu } from './ChoiceMenu'
import { ValidationScope } from './validation'
import { PresentationEditor } from './PresentationEditor'
import { defaultSectionOrder } from '../shared/order'

type PanelTab = 'editor' | 'layout' | 'document'
export function EditorPanel({
  document,
  onChange,
  sectionId,
  onSection,
  pending,
}: {
  document: ResumeDocument
  onChange: (document: ResumeDocument) => void
  sectionId: string | null
  onSection: (id: string | null) => void
  pending: boolean
}) {
  const [tab, setTab] = useState<PanelTab>('editor')
  const ids = useTabPanelIds('resume-editor')
  const move = (id: string, index: number) => {
    const sections = [...document.sections]
    const old = sections.findIndex((section) => section.id === id)
    const [section] = sections.splice(old, 1)
    sections.splice(index, 0, section!)
    onChange({ ...document, sections })
  }
  const replace = (id: string, value: Partial<ResumeDocument['sections'][number]>) =>
    onChange({
      ...document,
      sections: document.sections.map((section) =>
        section.id === id ? { ...section, ...value } : section,
      ),
    })
  return (
    <aside aria-label="Resume editor" className="@container flex min-h-0 min-w-0 flex-1 flex-col">
      <TabStrip
        aria-label="Resume editor panels"
        variant="compact"
        activeId={tab}
        onChange={setTab}
        items={(['editor', 'layout', 'document'] as const).map((id) => ({
          id,
          label: { editor: 'Editor', layout: 'Layout', document: 'Document' }[id],
          ...ids.item(id),
        }))}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <fieldset disabled={pending} className="min-w-0">
          <TabPanel
            active={tab === 'editor'}
            id={ids.panelId('editor')}
            aria-labelledby={ids.tabId('editor')}
          >
            <CollapsibleSection
              title="Personal information"
              open={sectionId === null}
              onOpenChange={(open) => {
                onSection(open ? null : 'collapsed')
              }}
              className="border-b border-border py-2"
            >
              <div className="px-4 py-4">
                <HeaderEditor document={document} onChange={onChange} identityOnly />
              </div>
            </CollapsibleSection>
            {document.sections.map((section, index) => (
              <ValidationScope key={section.id} prefix={`sections.${index}`}>
                <CollapsibleSection
                  title={section.title}
                  open={sectionId === section.id}
                  onOpenChange={(open) => onSection(open ? section.id : null)}
                  className="border-b border-border py-2"
                  actions={
                    <>
                      <IconButton
                        size="sm"
                        aria-label={`${section.hidden ? 'Show' : 'Hide'} ${section.title}`}
                        onClick={() => replace(section.id, { hidden: !section.hidden })}
                      >
                        {section.hidden ? <EyeOff /> : <Eye />}
                      </IconButton>
                      <IconButton
                        size="sm"
                        aria-label={`Move ${section.title} up`}
                        disabled={index === 0}
                        onClick={() => move(section.id, index - 1)}
                      >
                        <ArrowUp />
                      </IconButton>
                      <IconButton
                        size="sm"
                        aria-label={`Move ${section.title} down`}
                        disabled={index === document.sections.length - 1}
                        onClick={() => move(section.id, index + 1)}
                      >
                        <ArrowDown />
                      </IconButton>
                      <IconButton
                        size="sm"
                        aria-label={`Remove ${section.title}`}
                        onClick={() => {
                          onChange({
                            ...document,
                            sections: document.sections.filter((item) => item.id !== section.id),
                          })
                          onSection(null)
                        }}
                      >
                        <Trash2 />
                      </IconButton>
                    </>
                  }
                >
                  <div className="px-4 py-3">
                    <SectionEditor
                      section={section}
                      disabled={pending}
                      onChange={(value) => replace(section.id, value)}
                    />
                  </div>
                </CollapsibleSection>
              </ValidationScope>
            ))}
            <div className="px-4 py-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({ ...document, sections: defaultSectionOrder(document.sections) })
                }
              >
                Reset section order
              </Button>
              <ChoiceMenu
                label="Add section"
                disabled={document.sections.length >= 24}
                entries={[
                  ...sectionTypes.map((type) => ({
                    id: type,
                    label: sectionDefinitions[type].title,
                    onSelect: () => {
                      const section = {
                        id: crypto.randomUUID(),
                        type,
                        title: sectionDefinitions[type].title,
                        hidden: false,
                        ...(type === 'custom' ? { variant: 'list' as const } : {}),
                        entries: [emptyEntry()],
                      }
                      onChange({ ...document, sections: [...document.sections, section] })
                      onSection(section.id)
                    },
                  })),
                  {
                    id: 'custom-rich',
                    label: 'Custom text section',
                    onSelect: () => {
                      const section = {
                        id: crypto.randomUUID(),
                        type: 'custom' as const,
                        variant: 'rich' as const,
                        title: 'Additional information',
                        hidden: false,
                        entries: [emptyEntry()],
                      }
                      onChange({ ...document, sections: [...document.sections, section] })
                      onSection(section.id)
                    },
                  },
                ]}
              />
            </div>
          </TabPanel>
          <TabPanel
            active={tab === 'layout'}
            id={ids.panelId('layout')}
            aria-labelledby={ids.tabId('layout')}
            className="space-y-4 px-4 py-4"
          >
            <h2 className="text-sm font-medium text-text-strong">Template</h2>
            <TemplateGallery
              value={document.presentation.template}
              onChange={(template) =>
                onChange({ ...document, presentation: { ...document.presentation, template } })
              }
              disabled={pending}
            />
            <PresentationEditor document={document} onChange={onChange} />
          </TabPanel>
          <TabPanel
            active={tab === 'document'}
            id={ids.panelId('document')}
            aria-labelledby={ids.tabId('document')}
            className="space-y-4 px-4 py-4"
          >
            <TextField
              field="title"
              label="Resume name"
              value={document.title}
              onChange={(title) => onChange({ ...document, title })}
            />
            <h2 className="pt-2 text-sm font-medium text-text-strong">Role context</h2>
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
          </TabPanel>
        </fieldset>
      </div>
    </aside>
  )
}
