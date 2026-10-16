import { describe, expect, test } from 'bun:test'
import { formatModelList } from './model-list'

const model = (id: string, name = id, contextLength?: number) => ({ id, name, contextLength })

describe('formatModelList', () => {
  test('empty list yields a clear message', () => {
    expect(formatModelList([], 'x')).toBe('No models available for this connection.')
  })

  test('marks the current model and shows rounded k-context', () => {
    const out = formatModelList([model('a', 'GPT', 128_000), model('b', 'Claude')], 'a')
    expect(out).toContain('`GPT` · 128k ctx ← current')
    expect(out).toContain('- `Claude`') // no ctx, not current
    expect(out).not.toContain('Claude` ← current')
  })

  test('caps at 40 entries with an "and N more" footer', () => {
    const models = Array.from({ length: 45 }, (_, i) => model(`m${i}`))
    const out = formatModelList(models, 'none')
    expect(out.split('\n').filter((l) => l.startsWith('- ')).length).toBe(40)
    expect(out).toContain('…and 5 more.')
  })

  test('no footer at exactly 40', () => {
    const out = formatModelList(
      Array.from({ length: 40 }, (_, i) => model(`m${i}`)),
      'none',
    )
    expect(out).not.toContain('more.')
  })
})
