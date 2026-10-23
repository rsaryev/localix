import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { bindMiniAppUiComponents } from '@localixai/mini-app-sdk/ui'
import { problemReportTitle } from '@localixai/mini-app-sdk/ui/problems'
import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>
let unbindComponents: (() => void) | undefined

/**
 * The reader renders `ProblemLine`, which the SDK resolves from the HOST-bound component set — in
 * the app that binding happens in `miniAppRuntime.ts`, and a test that never performs it makes the
 * very first render throw "Mini app UI components are not bound by the host". Bound to the same
 * minimal stubs a host binding provides, with `ProblemLine` rendering the real headline so a
 * raw driver message cannot slip onto the surface unnoticed.
 */
function bindHostComponents(): () => void {
  const Empty = () => null
  const Problem = ({ report, actions }: MiniAppProblemLineProps) => (
    <div role="alert">
      <span>{problemReportTitle(report)}</span>
      {/* The ways OUT are the point of this line, and the reader's tests assert on them by
          label — a stub that rendered only "Details" would pass a surface with no exit. */}
      {(actions ?? []).map((action) => (
        <button key={action.id} type="button" onClick={() => void action.run()}>
          {action.label}
        </button>
      ))}
      <button type="button">Details</button>
    </div>
  )
  return bindMiniAppUiComponents({
    FileTab: Empty,
    TableGrid: Empty,
    ContextBindingIcon: Empty,
    ContextBindingPreview: Empty,
    Input: ({ size: _size, ...props }) => <input {...props} />,
    Textarea: (props) => <textarea {...props} />,
    ProblemLine: Problem,
    ProblemState: Problem,
  })
}

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  unbindComponents = bindHostComponents()
})

afterAll(async () => {
  unbindComponents?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function renderFailure(props: {
  source: { path: string } | { mediaId: string; name?: string }
  message: string
  onBack?: () => void
  onRetry?: () => void
}) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { useReaderOpenFailure } = await import('./ReaderOpenFailure')
  // The hook is the surface now; a host mounts it the way the reading pane does.
  const ReaderOpenFailure = (own: typeof props) =>
    useReaderOpenFailure({ sessionId: 'session-1', ...own })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<ReaderOpenFailure {...props} />)
  })
  const buttons = () =>
    [...host.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')
  return { host, root, buttons }
}

describe('ReaderOpenFailure', () => {
  test('a failed open always offers a way back to the library', async () => {
    let back = 0
    const { host, root, buttons } = await renderFailure({
      source: { path: '/books/broken.epub' },
      message: 'Book is larger than the reader limit',
      onBack: () => (back += 1),
      onRetry: () => {},
    })
    try {
      expect(buttons()).toContain('Back to library')
      // A transient failure is recoverable in place.
      expect(buttons()).toContain('Try again')
      expect(host.textContent).toContain('Book is larger than the reader limit')
      const React = await import('react')
      await React.act(async () => {
        ;[...host.querySelectorAll('button')]
          .find((button) => button.textContent?.includes('Back to library'))!
          .click()
      })
      expect(back).toBe(1)
    } finally {
      const React = await import('react')
      await React.act(async () => root.unmount())
      host.remove()
    }
  })

  test('an unsupported format names the file and drops the pointless retry', async () => {
    const { host, root, buttons } = await renderFailure({
      source: { path: '/pictures/screenshot.png' },
      message: '.png is not a reading format.',
      onBack: () => {},
      onRetry: () => {},
    })
    try {
      expect(host.textContent).toContain('Reader cannot open screenshot.png')
      expect(buttons()).toContain('Back to library')
      expect(buttons()).toContain('Open outside Reader')
      expect(buttons()).not.toContain('Try again')
    } finally {
      const React = await import('react')
      await React.act(async () => root.unmount())
      host.remove()
    }
  })

  test('a media-backed source has no path to hand another viewer', async () => {
    const { root, buttons } = await renderFailure({
      source: { mediaId: 'abc', name: 'dropped.png' },
      message: '.png is not a reading format.',
      onBack: () => {},
    })
    try {
      expect(buttons()).not.toContain('Open outside Reader')
      expect(buttons()).toContain('Back to library')
    } finally {
      const React = await import('react')
      await React.act(async () => root.unmount())
    }
  })
})
