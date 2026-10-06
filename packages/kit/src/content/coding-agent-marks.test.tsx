import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClaudeMark, CodexMark } from './coding-agent-marks'

test('brand marks retain their distinct silhouettes and accessible decorative frames', () => {
  const claude = renderToStaticMarkup(<ClaudeMark className="size-3" />)
  const codex = renderToStaticMarkup(<CodexMark className="size-3" />)
  for (const html of [claude, codex]) {
    expect(html).toContain('viewBox="0 0 100 100"')
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('focusable="false"')
    expect(html).toContain('class="size-3"')
  }
  expect(claude).toContain('M25.7146 63.2153')
  expect(codex).toContain('M83.7733 42.8087')
  expect(claude).not.toBe(codex)
})
