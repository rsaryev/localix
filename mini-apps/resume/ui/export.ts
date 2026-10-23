import { z } from 'zod'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { postMiniAppJson, unwrapMiniAppResponse } from '@localixai/mini-app-sdk/ui/transport'
import { exportDocument, type ExportFormat } from '../shared/format'
import type { Resume } from '../shared/schema'
import { resumeLayout } from '../shared/layout'
import { renderResumePdf } from './pdf'

export async function downloadResume(
  resume: Resume,
  format: ExportFormat | 'pdf' | 'docx',
  sessionId: string,
) {
  const name = resume.document.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100) || 'resume'
  if (format === 'pdf') {
    await miniAppFiles.saveBlob(`${name}.pdf`, await renderResumePdf(resume.document))
    return
  }
  if (format === 'docx') {
    // Compose with the installed Documents mini app through its public API; no office library copy.
    const response = await postMiniAppJson('/rpc/documents/generate', {
      format,
      content: exportDocument(resume.document, 'markdown'),
      filename: name,
      layout: resumeLayout(resume.document),
    })
    const result = z
      .object({
        mediaId: z
          .string()
          .regex(/^[a-zA-Z0-9._-]+$/)
          .nullable(),
      })
      .parse(await unwrapMiniAppResponse<unknown>(response))
    if (!result.mediaId)
      throw new Error(
        'Documents could not save the generated file. Export Markdown and retry generation.',
      )
    await miniAppFiles.download(
      `/rpc/media/${encodeURIComponent(result.mediaId)}`,
      `${name}.${format}`,
    )
    return
  }
  const extension = { json: 'json', markdown: 'md', text: 'txt', yaml: 'yaml', lanjut: 'json' }[
    format
  ]
  await miniAppFiles.download(
    `/rpc/resume/${resume.id}/export/${format}?${new URLSearchParams({ sessionId })}`,
    `${name}.${extension}`,
  )
}
