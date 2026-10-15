import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('throttled markdown preview', () => {
  /**
   * The split markdown preview re-parses the WHOLE buffer, so it is driven by the
   * throttle rather than the raw buffer. The contract that must never regress:
   * fast edits are coalesced, but the FINAL text is always rendered — a trailing
   * commit means the reader can never be left looking at a stale document.
   */
  test('coalesces fast edits and still lands the final text', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useStreamingThrottle, STREAM_MARKDOWN_REPARSE_MS } =
      await import('./useStreamingThrottle')

    const rendered: string[] = []
    function Preview({ text }: { text: string }) {
      const shown = useStreamingThrottle(text, true, STREAM_MARKDOWN_REPARSE_MS)
      rendered.push(shown)
      return <span>{shown}</span>
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<Preview text="" />)
    })
    // A burst of keystrokes, faster than the reparse cadence.
    // One act for the whole burst: a separate awaited act per keystroke takes longer than the
    // reparse cadence on a slow runner, so the throttle would already have let a render through.
    await act(async () => {
      for (const text of ['# a', '# ab', '# abc', '# abcd', '# abcde']) {
        root.render(<Preview text={text} />)
      }
    })
    // Mid-burst the preview lags on purpose: that is the whole point.
    expect(rendered.at(-1)).not.toBe('# abcde')

    await act(async () => {
      await settle(STREAM_MARKDOWN_REPARSE_MS * 6)
    })
    expect(host.textContent).toBe('# abcde')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  test('returns the value verbatim when the preview is not mounted', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useStreamingThrottle } = await import('./useStreamingThrottle')

    function Editor({ text }: { text: string }) {
      return <span>{useStreamingThrottle(text, false, 40)}</span>
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<Editor text="one" />)
    })
    await act(async () => {
      root.render(<Editor text="two" />)
    })
    expect(host.textContent).toBe('two')

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  test('the file tab renders the throttled text, not the live buffer', () => {
    const source = readFileSync(
      new URL('../../features/inspector/ui/FileTab.tsx', import.meta.url),
      'utf8',
    )
    const body = readFileSync(
      new URL('../../features/inspector/ui/FileEditorBody.tsx', import.meta.url),
      'utf8',
    )
    expect(body).not.toContain('<MarkdownRenderer>{buffer}</MarkdownRenderer>')
    expect(body).toContain('<MarkdownRenderer>{previewText}</MarkdownRenderer>')
    expect(source).toContain('previewText={previewText}')
    expect(source).toContain(
      'const previewText = useStreamingThrottle(buffer, previewMounted, STREAM_MARKDOWN_REPARSE_MS)',
    )
  })
})
