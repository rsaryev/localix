import { richTextToText } from '@localixai/mini-app-sdk/rich-text'
import type { Resume } from '../shared/schema'
import { sectionDefinitions } from '../shared/sections'
import { templates } from '../shared/templates'
import { resumeUri } from '../shared/resource-uri'

/** What an author needs and nothing a renderer needs: template metrics stay out of it. */
export function resumeGuide() {
  return {
    templates: Object.fromEntries(
      Object.values(templates).map((template) => [template.id, template.description]),
    ),
    sections: Object.fromEntries(
      Object.entries(sectionDefinitions).map(([type, definition]) => [
        type,
        {
          fields: definition.fields,
          ...(definition.titleLabel ? { title: definition.titleLabel } : {}),
          ...(definition.organizationLabel ? { organization: definition.organizationLabel } : {}),
        },
      ]),
    ),
    authoring: [
      'Write only fields with content. ids, empty fields, link: null, section titles and hidden: false are filled in.',
      'Dates are YYYY or YYYY-MM. end: "present" (or current: true) marks an ongoing entry.',
      'summary: one entry with body only. skills/languages: title = group or language, body = comma-separated items, optional proficiency; no bullets.',
      'context (one line about the company) belongs to experience/internship; proficiency to skills/languages; variant (rich|list) only to custom sections.',
      'Fields a section type does not take are moved or dropped and reported in notes; read the notes.',
      'body accepts plain text or restricted rich text: {type:"doc",content:[paragraph|bulletList|orderedList]} with bold/italic/link marks. Keep existing formatting when editing.',
    ],
    example: {
      action: 'init',
      title: 'Jane Doe — Backend Engineer',
      template: 'awal',
      document: {
        targetRole: 'Backend Engineer',
        header: { name: 'Jane Doe', headline: 'Backend Engineer', email: 'jane@example.com' },
        sections: [
          { type: 'summary', entries: [{ body: 'Backend engineer with 6 years…' }] },
          {
            type: 'experience',
            entries: [
              {
                title: 'Senior Backend Engineer',
                organization: 'Acme',
                start: '2021-03',
                end: 'present',
                bullets: ['Cut p99 latency by 40%…'],
              },
            ],
          },
          { type: 'skills', entries: [{ title: 'Languages', body: 'Go, SQL' }] },
        ],
      },
    },
    operations: [
      'header {value}: merge contact fields; links are URLs or {label,url}',
      'metadata {value}: title, targetRole, jobDescription',
      'presentation {value}: merge template, font, language (en|id), showIcons, sectionSpacing, letterSpacing, lineHeight, nameScale, titleScale, bodyScale, photoSize, photoRadius, photoAlign',
      'addSection {section}',
      'updateSection {sectionId, value: title?, hidden?, columns?, showProficiency?, variant?}',
      'removeSection / moveSection {sectionId, index}',
      'addEntry {sectionId, entry}: sectionId may be a section type; the section is created if missing',
      'updateEntry {sectionId, entryId, value}: only the changed fields',
      'removeEntry / moveEntry {sectionId, entryId, index}',
    ],
    limits:
      '100 resumes; 24 sections; 60 entries per section; 30 bullets per entry; 50 operations per update; 100,000 characters.',
    files:
      'Each resume is .localix/resumes/<id>/resume.json, shared with the Resumes workbench. get returns its current revision; file tools may edit it too.',
    exports:
      'export returns text; it writes no file and makes no PDF/DOCX (the workbench exports those through Documents). Target role and job description are context, never exported.',
  }
}

function label(entry: Resume['document']['sections'][number]['entries'][number]) {
  const text = entry.title || entry.organization || richTextToText(entry.body)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/** The ids and revision an author needs next — not an echo of what it just wrote. */
export function resumeOutline(resume: Resume, path: string, notes: string[] = []) {
  return {
    id: resume.id,
    revision: resume.revision,
    path,
    uri: resumeUri(resume.id),
    title: resume.document.title,
    template: resume.document.presentation.template,
    sections: resume.document.sections.map((section) => ({
      id: section.id,
      type: section.type,
      title: section.title,
      ...(section.hidden ? { hidden: true } : {}),
      entries: section.entries.map((entry) => ({ id: entry.id, label: label(entry) })),
    })),
    ...(notes.length > 0 ? { notes } : {}),
  }
}
