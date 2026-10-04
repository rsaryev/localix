/** Build the exact response snippet published as ambient workbench context. */
import type { SendResponse } from '../../backend/contracts'
import { formatBodyForModel } from '../../model/model-context'

export interface ResponseContextInput {
  response: SendResponse
}

export interface ResponseContextMaterial {
  /**
   * A self-contained HTTP response summary. It deliberately contains NO Markdown fence: the host
   * owns the one model-facing fence for a snippet binding. JSON is rendered through the shared
   * safe body formatter so ordinary `body` fields do not trip secret admission.
   */
  snippet: string
  /**
   * The host fence language. `http` matches the status/header/body envelope rather than claiming
   * the whole snippet is JSON merely because its final section is JSON.
   */
  language: string
}

/**
 * PURE — no bus and no DOM. The response has already had request credentials removed by the
 * backend; the shared formatter additionally masks credential-shaped response fields.
 */
export function buildResponseContext({ response }: ResponseContextInput): ResponseContextMaterial {
  const language = 'http'
  const contentType = response.headers['content-type']
  const lines = [
    `HTTP ${response.status} ${response.statusText}`.trimEnd(),
    `URL: ${response.url}`,
    ...(contentType ? [`Content-Type: ${contentType}`] : []),
    `Elapsed: ${response.elapsedMs} ms`,
    `Size: ${response.bytes} bytes${response.truncated ? ' (truncated)' : ''}`,
    '',
    'Body:',
    formatBodyForModel(response.body, contentType),
  ]
  const snippet = lines.join('\n')
  return {
    snippet,
    language,
  }
}
