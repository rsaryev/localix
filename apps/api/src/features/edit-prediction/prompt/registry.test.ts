import { describe, expect, it } from 'bun:test'
import { EDIT_PREDICTION_PROMPT } from './registry'
import type { PredictNextEditRequest } from '../contracts'

const REQ: PredictNextEditRequest = {
  sessionId: 's',
  requestId: 'req-1',
  filepath: '/p/a.ts',
  content: 'const a = 1\nconst b = 2',
  documentVersion: 1,
  documentDigest: 'digest-1',
  cursorLine: 1,
  language: 'typescript',
  recentlyEditedRanges: [],
}

describe('prompt registry', () => {
  it('exposes one canonical strict-JSON prompt', () => {
    expect(EDIT_PREDICTION_PROMPT.build(REQ).systemPrompt).toContain('Reply with STRICT JSON only')
  })
})
