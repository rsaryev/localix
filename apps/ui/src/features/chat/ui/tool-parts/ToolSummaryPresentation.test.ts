import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('tool summaries use flat counts and semantic error icons', () => {
  const ask = read('./AskToolPart.tsx')
  const chain = read('./ToolChainHeader.tsx')
  const stack = read('./cards/StackedItemGroup.tsx')
  const surfaces = [ask, chain, stack].join('\n')

  expect(chain).toContain('<CircleAlert')
  expect(stack).toContain('<CircleAlert')
  expect(surfaces).not.toContain('<Chip')
  expect(ask).not.toContain('bg-surface-hover px-1.5')
})
