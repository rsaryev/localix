import { describe, expect, test } from 'bun:test'

import { withContextReminder } from './tool-hook-results'

/**
 * A tool hook's `additionalContext` beside the tool result (hooks.md, "JSON output"): the kit caps
 * each hook's string at 10,000 characters and saves a longer one to a file, so the joined notes of
 * several hooks arrive whole. The reminder tags inside them were escaped where the note was made
 * (`plugins/kit/hooks/runtime.test.ts`).
 */
describe('a tool hook’s context beside the tool result', () => {
  test('the joined notes of several hooks are not cut', () => {
    const note = Array.from({ length: 5 }, () => 'n'.repeat(10_000)).join('\n')
    const out = withContextReminder('result', note)
    expect(out).toBe(`result\n\n<system-reminder>\n${note}\n</system-reminder>`)
  })

  test('an empty note adds nothing', () => {
    expect(withContextReminder('r', '  ')).toBe('r')
  })
})
