import { z } from 'zod'
import {
  miniAppApiFetch,
  postMiniAppJson,
  unwrapMiniAppResponse,
} from '@localixai/mini-app-sdk/ui/transport'
import { parseResumeFile } from '../shared/interchange'
import { importSourceText } from '../shared/source-import'
import type { ResumeDocument } from '../shared/schema'
export async function importResumeFile(
  file: File,
): Promise<{ document: ResumeDocument; leftovers: string; source: boolean }> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a source file under 25 MiB.')
  if (/\.(json|ya?ml)$/iu.test(file.name))
    return { document: parseResumeFile(await file.text(), file.name), leftovers: '', source: false }
  const title = file.name.replace(/\.[^.]+$/u, '') || 'Imported resume'
  let text: string
  if (/\.(txt|md)$/iu.test(file.name)) text = await file.text()
  else {
    if (!/\.(pdf|docx|doc|odt)$/iu.test(file.name))
      throw new Error('Choose JSON, YAML, PDF, Word, ODT, Markdown or plain text.')
    const upload = await miniAppApiFetch(`/rpc/media?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    const media = z
      .object({ id: z.string().regex(/^[a-zA-Z0-9._-]+$/u) })
      .parse(await unwrapMiniAppResponse(upload))
    const response = await postMiniAppJson('/rpc/documents/extract', { mediaId: media.id })
    const extracted = z
      .object({ document: z.object({ kind: z.literal('text'), markdown: z.string() }) })
      .parse(await unwrapMiniAppResponse(response))
    text = extracted.document.markdown
    if (!text.trim())
      throw new Error(
        'No readable text found. For a scanned PDF, ask the agent to read the image and create the resume.',
      )
  }
  return { ...importSourceText(text, title), source: true }
}
