import {
  resourceMessageBindingDraft,
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { resumeUri } from '../shared/resource-uri'
import { exportDocument, sectionText } from '../shared/format'
import type { Resume, ResumeDocument } from '../shared/schema'

/** Saved state uses a resolvable locator; unsaved visible content is an explicitly labeled snapshot. */
export function resumeMessageContext(
  resume: Resume,
  draft: ResumeDocument,
  sectionId: string | null,
  dirty: boolean,
): PublishedMessageContext {
  const section = draft.sections.find((item) => item.id === sectionId)
  const uri = resumeUri(resume.id, section?.id)
  if (!dirty)
    return {
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri,
          label: section ? `${draft.title} · ${section.title}` : draft.title,
        }),
      ],
    }
  return {
    strategy: 'replace',
    bindings: [
      snippetMessageBindingDraft({
        label: `${draft.title} · unsaved draft${section ? ` · ${section.title}` : ''}`,
        language: 'text',
        content: [
          `UNSAVED editor draft. Resume ID: ${resume.id}. Base revision: ${resume.revision}.`,
          'This snapshot is visible evidence, not saved state. Call resume get before applying edits.',
          section
            ? `Section ID: ${section.id}\n${sectionText(section)}`
            : exportDocument(draft, 'text'),
          draft.targetRole ? `Target role: ${draft.targetRole}` : '',
          draft.jobDescription ? `User-provided job description:\n${draft.jobDescription}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      }),
    ],
  }
}
