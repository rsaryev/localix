import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./FileEditorPicker.tsx', import.meta.url), 'utf8')

test('file editor choices use a flat IDE list instead of nested cards', () => {
  // A ruled list from the shared recipe, not a card per choice.
  expect(source).toContain('className={DIVIDED_LIST}')
  expect(source).toContain('<Checkbox')
  expect(source).not.toContain('max-w-sm rounded-lg border')
  expect(source).not.toContain('rounded-md border border-border px-3 py-2')
})
