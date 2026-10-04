import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { TranscriptActionDestination } from '../model/openTranscript'

import { forgetTranscripts, openTranscript } from '../model/openTranscript'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  forgetTranscripts(new Set())
  document.body.innerHTML = ''
})

afterAll(async () => {
  await teardown()
})

describe('read-only transcript action footer', () => {
  test('replaces the composer position with one explicit import action and pending state', async () => {
    let finish: ((destination: TranscriptActionDestination) => void) | undefined
    const pending = new Promise<TranscriptActionDestination>((resolve) => {
      finish = resolve
    })
    openTranscript({
      id: 'external-agent:preview',
      sessionId: 'reader-session',
      title: 'Foreign session',
      messages: [],
      action: {
        label: 'Import session',
        pendingLabel: 'Importing…',
        description: 'Keep this conversation in Localix with cwd /work/acme',
        run: () => pending,
      },
    })

    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter, useLocation } = await import('react-router')
    const { TranscriptTab } = await import('./TranscriptTab')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const LocationProbe = () => {
      const location = useLocation()
      return React.createElement('output', { 'data-slot': 'location' }, location.pathname)
    }

    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/project/old-project/old-session'] },
          React.createElement(TranscriptTab, {
            transcriptId: 'external-agent:preview',
            focused: true,
          }),
          React.createElement(LocationProbe),
        ),
      )
    })

    const footer = host.querySelector('[data-slot="transcript-action-footer"]')
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Import session"]')
    expect(footer?.textContent).toContain('/work/acme')
    expect(host.querySelector('textarea')).toBeNull()
    expect(button?.querySelector('svg.lucide-import')).not.toBeNull()

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    expect(button?.disabled).toBe(true)
    expect(button?.textContent).toContain('Importing…')

    await act(async () => {
      finish?.({ sessionId: 'LOCALIX-42', projectId: 'project-acme' })
      await pending
    })
    expect(button?.disabled).toBe(false)
    expect(button?.textContent).toContain('Import session')
    expect(host.querySelector('[data-slot="location"]')?.textContent).toBe(
      '/project/project-acme/LOCALIX-42',
    )

    await act(async () => {
      root.unmount()
    })
  })

  test('contains the floating scroll control above the sibling action footer', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TranscriptView } = await import('./TranscriptView')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const scrollRef = React.createRef<HTMLDivElement>()

    await act(async () => {
      root.render(
        React.createElement(
          'div',
          { className: 'relative flex h-full min-h-0 flex-col' },
          React.createElement(TranscriptView, {
            messages: [],
            sessionId: 'external-agent:preview',
            isFocused: true,
            scroll: {
              scrollRef,
              showScrollToBottom: true,
              scrollToBottom: () => {},
              forceScrollToBottom: () => {},
            },
          }),
          React.createElement('div', { 'data-slot': 'transcript-action-footer' }, 'Import'),
        ),
      )
    })

    const view = host.querySelector('[data-slot="transcript-view"]')
    const control = host.querySelector('[data-slot="transcript-scroll-control"]')
    const footer = host.querySelector('[data-slot="transcript-action-footer"]')
    expect(view?.classList.contains('relative')).toBe(true)
    expect(view?.contains(control)).toBe(true)
    expect(footer?.contains(control)).toBe(false)
    expect(view?.nextElementSibling).toBe(footer)

    await act(async () => {
      root.unmount()
    })
  })
})
