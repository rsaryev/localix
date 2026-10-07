import { z } from 'zod'
import { pluginFiles } from '@localixai/plugin-sdk/ui/runtime'
import { postPluginJson, unwrapPluginResponse } from '@localixai/plugin-sdk/ui/transport'
import { exportDocument, type ExportFormat } from '../shared/format'
import type { Resume } from '../shared/schema'

export async function downloadResume(
  resume: Resume,
  format: ExportFormat | 'pdf' | 'docx',
  sessionId: string,
) {
  const name = resume.document.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100) || 'resume'
  if (format === 'pdf' || format === 'docx') {
    // Compose with the installed Documents plugin through its public API; no office library copy.
    const response = await postPluginJson('/rpc/documents/generate', {
      format,
      content: exportDocument(resume.document, 'markdown'),
      filename: name,
    })
    const result = z
      .object({
        mediaId: z
          .string()
          .regex(/^[a-zA-Z0-9._-]+$/)
          .nullable(),
      })
      .parse(await unwrapPluginResponse<unknown>(response))
    if (!result.mediaId)
      throw new Error(
        'Documents could not save the generated file. Export Markdown and retry generation.',
      )
    await pluginFiles.download(
      `/rpc/media/${encodeURIComponent(result.mediaId)}`,
      `${name}.${format}`,
    )
    return
  }
  const extension = { json: 'json', markdown: 'md', text: 'txt' }[format]
  await pluginFiles.download(
    `/rpc/resume/${resume.id}/export/${format}?${new URLSearchParams({ sessionId })}`,
    `${name}.${extension}`,
  )
}
