import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ClaudeMark,
  CodexMark,
  GeminiMark,
  CopilotMark,
  OpenCodeMark,
  HermesMark,
} from './coding-agent-marks'

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

test('every supported external agent has a distinct mark that follows the theme', () => {
  const icons = [ClaudeMark, CodexMark, GeminiMark, CopilotMark, OpenCodeMark, HermesMark]
  const silhouettes = icons.map((Icon) => renderToStaticMarkup(<Icon className="size-3.5" />))
  expect(new Set(silhouettes).size).toBe(icons.length)
  for (const html of silhouettes) {
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('focusable="false"')
    expect(html).toContain('class="size-3.5"')
    expect(html).not.toContain('<rect')
  }
})
