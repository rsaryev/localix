import { describe, expect, test } from 'bun:test'
import { resolveNextEditPredictionResponse } from './editor-assist-client'

const request = {
  requestId: 'request-42',
  documentVersion: 7,
  documentDigest: 'fnv1a64:0123456789abcdef:12',
}
const edit = {
  startLine: 1,
  endLine: 1,
  original: 'const current = 1;',
  replacement: 'const next = 1;',
}

describe('resolveNextEditPredictionResponse', () => {
  test.each([
    ['request_id', { requestId: 'other-request' }],
    ['document_version', { documentVersion: 8 }],
    ['document_digest', { documentDigest: 'fnv1a64:fedcba9876543210:12' }],
  ] as const)('drops a v2 response with a mismatched %s', (mismatch, patch) => {
    const result = resolveNextEditPredictionResponse(request, {
      protocolVersion: 2,
      ...request,
      ...patch,
      outcome: 'predicted',
      edits: [edit],
    })

    expect(result).toEqual({
      outcome: 'stale_delivery',
      edits: null,
      diagnostic: { code: 'stale_delivery', mismatch },
    })
    expect(JSON.stringify(result)).not.toContain('fnv1a64:')
    expect(JSON.stringify(result)).not.toContain('request-42')
  })

  test('requires every v2 correlation field and preserves a matching prediction', () => {
    const missingDigest = resolveNextEditPredictionResponse(request, {
      protocolVersion: 2,
      requestId: request.requestId,
      documentVersion: request.documentVersion,
      outcome: 'predicted',
      edits: [edit],
    })
    expect(missingDigest).toEqual({
      outcome: 'stale_delivery',
      edits: null,
      diagnostic: { code: 'stale_delivery', mismatch: 'document_digest' },
    })

    expect(
      resolveNextEditPredictionResponse(request, {
        protocolVersion: 2,
        ...request,
        outcome: 'predicted',
        edits: [edit],
      }),
    ).toEqual({ outcome: 'predicted', edits: [edit] })
  })
})
