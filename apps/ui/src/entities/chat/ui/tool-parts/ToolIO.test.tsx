import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConsoleOutput } from './ConsoleOutput'
import { LinkedText } from './LinkedText'
import { DiffStat, OutputBlock } from './ToolIO'

describe('OutputBlock projection', () => {
  test('colors detected JSON safely and keeps source paths and URLs actionable', () => {
    const html = renderToStaticMarkup(
      <OutputBlock linkify>
        {'{"path":"/workspace/a.ts","url":"https://example.com/a.ts","html":"<script>","ok":true}'}
      </OutputBlock>,
    )
    expect(html).toContain('sh__token--string')
    expect(html).toContain('sh__token--keyword')
    expect(html).toContain('data-slot="text-action"')
    expect(html).toContain('href="https://example.com/a.ts"')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  test('leaves prose and streaming output plain and colors a settled JSON console', () => {
    const prose = renderToStaticMarkup(<OutputBlock>The return value is null.</OutputBlock>)
    const streaming = renderToStaticMarkup(<ConsoleOutput output={'{"ok":true}'} isStreaming />)
    const settled = renderToStaticMarkup(
      <ConsoleOutput output={'{"ok":true}'} isStreaming={false} />,
    )
    expect(prose).not.toContain('sh__token--')
    expect(streaming).not.toContain('sh__token--')
    expect(settled).toContain('sh__token--keyword')
  })

  test('bounds settled tool output through the same tail projection as live console output', () => {
    const output = `${'old\n'.repeat(30_000)}final diagnostic`
    const html = renderToStaticMarkup(<OutputBlock>{output}</OutputBlock>)

    expect(html).toContain('earlier output truncated')
    expect(html).toContain('final diagnostic')
    expect(html).not.toContain('old\n'.repeat(30_000))
    expect(html).toContain('aria-label="Copy full output"')
    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-size="icon-xs"')
    expect(html).toContain('data-tooltip-trigger="true"')
    expect(html).not.toContain('title="Copy full output"')
  })

  test('bounds before linkifying so omitted paths never enter the DOM', () => {
    const output = `${'src/omitted.ts:1\n'.repeat(8_000)}src/kept.ts:42`
    const html = renderToStaticMarkup(<OutputBlock linkify>{output}</OutputBlock>)

    expect(html).toContain('earlier output truncated')
    expect(html).toContain('src/kept.ts:42')
    expect(html).not.toContain('src/omitted.ts:1'.repeat(8_000))
  })

  test('keeps settled and streaming console bodies free of nested card chrome', () => {
    const settled = renderToStaticMarkup(<OutputBlock>done</OutputBlock>)
    const streaming = renderToStaticMarkup(<ConsoleOutput output="running" isStreaming />)

    for (const html of [settled, streaming]) {
      expect(html).not.toContain('bg-surface-raised')
      expect(html).not.toContain('border-control-border')
      expect(html).not.toContain('shadow-sm')
    }
  })
})

describe('ToolIO managed hints', () => {
  test('keeps passive diff metadata and external-link actions off native title', () => {
    const html = renderToStaticMarkup(
      <>
        <DiffStat additions={12} deletions={4} />
        <LinkedText text="https://example.com/reference" />
      </>,
    )

    expect(html).toContain('class="sr-only">12 additions, 4 deletions')
    expect(html).toContain('aria-hidden="true"')
    expect(html.match(/data-tooltip-trigger="true"/g)).toHaveLength(2)
    expect(html).not.toContain('title=')
  })
})
