import { describe, expect, test } from 'bun:test'
import { AGENTS_ARGS } from './slash-catalog-agents'
import { parseCommandArgs } from './slash-args'

describe('/agents arguments', () => {
  test('offers list and help, and completes a typed prefix', () => {
    const parsed = parseCommandArgs('li', AGENTS_ARGS)
    expect(parsed.activeSpec?.type).toBe('choice')
    expect(parsed.activeText).toBe('li')
  })
})
