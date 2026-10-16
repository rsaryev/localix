import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('HITL and connection metadata avoid decorative status pills', () => {
  const frame = read('./HitlInteractionFrame.tsx')
  const ask = read('./AskQuestionForm.tsx')
  const connection = read('../prompt-input/model-select/AddConnectionForm.tsx')
  const sources = [frame, ask, connection].join('\n')

  expect(ask).toContain('<CheckCircle2')
  expect(connection).toContain('<LogIn')
  expect(connection).toContain('<KeyRound')
  expect(sources).not.toContain('rounded-full bg-surface-hover')
  expect(connection).not.toContain('rounded-full bg-sidebar')
})
