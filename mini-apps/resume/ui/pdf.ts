import { postMiniAppJson, unwrapMiniAppResponse } from '@localixai/mini-app-sdk/ui/transport'
import { resumeLayout } from '../shared/layout'
import type { ResumeDocument } from '../shared/schema'

// Bound to the last three documents; preview and PDF download consume the same immutable bytes.
const cache = new Map<string, Promise<Blob>>()
export function renderResumePdf(document: ResumeDocument): Promise<Blob> {
  const layout = resumeLayout(document)
  const key = JSON.stringify(layout)
  const existing = cache.get(key)
  if (existing) return existing
  const pending = postMiniAppJson('/rpc/documents/render', {
    format: 'pdf',
    content: 'Resume',
    layout,
  })
    .then(async (response) => {
      if (!response.ok) await unwrapMiniAppResponse(response)
      return response.blob()
    })
    .catch((error) => {
      cache.delete(key)
      throw error
    })
  cache.set(key, pending)
  if (cache.size > 3) cache.delete(cache.keys().next().value!)
  return pending
}
