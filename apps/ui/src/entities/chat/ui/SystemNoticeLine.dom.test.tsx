import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { SystemNotice } from '../model/types'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

async function render(notice: SystemNotice, onRetry?: () => void, repeatCount?: number) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { SystemNoticeLine } = await import('./SystemNoticeLine')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<SystemNoticeLine notice={notice} onRetry={onRetry} repeatCount={repeatCount} />)
  })
  return {
    host,
    button: () => host.querySelector('button'),
    async cleanup() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const interrupted: SystemNotice = {
  kind: 'run_interrupted',
  tone: 'warning',
  text: 'Backend restarted — this reply is incomplete.',
  recovery: ['retry'],
}

describe('a notice that can be acted on', () => {
  /**
   * A reply that did not finish is decided on above the composer (`ResumeStrip`, Continue). In the
   * transcript it is only a marker of where it happened: the amber sentence with a Retry beside it
   * in every place a conversation once stopped was the noise this replaces.
   */
  test('a reply that did not finish is a quiet marker: a short label, the sentence on hover', async () => {
    const view = await render(interrupted, () => {}, 3)
    try {
      expect(view.button()).toBeNull()
      expect(view.host.textContent).toContain('Reply interrupted')
      expect(view.host.textContent).toContain('×3')
      const line = view.host.querySelector('[role="status"]')
      expect(line?.getAttribute('title')).toContain('this reply is incomplete')
    } finally {
      await view.cleanup()
    }
  })

  test('an ordinary notice stays a line, not a control', async () => {
    const view = await render({ kind: 'model_change', tone: 'neutral', text: 'Model changed' })
    try {
      expect(view.button()).toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test('a turn limit reads the same way', async () => {
    const view = await render(
      { kind: 'turn_limit', tone: 'neutral', text: 'Stopped after 40 turns.', recovery: ['retry'] },
      () => {},
    )
    try {
      expect(view.button()).toBeNull()
      expect(view.host.textContent).toContain('Turn limit reached')
    } finally {
      await view.cleanup()
    }
  })

  test('a mode line is drawn in the mode it switched to', async () => {
    // Drawn by kind alone, every mode was the same shield in the same tone: a switch to
    // Autonomous read exactly like a switch back to Default.
    const view = await render({
      kind: 'permission_mode_change',
      tone: 'info',
      text: 'Permission mode set to Autonomous.',
      mode: 'autonomous',
    })
    try {
      const line = view.host.querySelector('[role="status"]')
      expect(line?.className).toContain('text-status-error')
      expect(line?.querySelector('svg')?.getAttribute('class')).toContain('lucide-zap')
    } finally {
      await view.cleanup()
    }
  })

  test('a mode line stored without its mode keeps the generic look', async () => {
    const view = await render({
      kind: 'permission_mode_change',
      tone: 'info',
      text: 'Permission mode set to Plan.',
    })
    try {
      const line = view.host.querySelector('[role="status"]')
      expect(line?.className).toContain('text-text-soft')
      expect(line?.querySelector('svg')?.getAttribute('class')).toContain('lucide-shield-check')
    } finally {
      await view.cleanup()
    }
  })
})

describe('a session recap', () => {
  test('reads as a labelled line with the whole recap, not as a control', async () => {
    const recap = 'You were fixing the login redirect; the session cookie is the next step.'
    const view = await render({ kind: 'session_recap', tone: 'neutral', text: recap })
    try {
      expect(view.button()).toBeNull()
      expect(view.host.textContent).toContain(`Recap: ${recap}`)
    } finally {
      await view.cleanup()
    }
  })
})
