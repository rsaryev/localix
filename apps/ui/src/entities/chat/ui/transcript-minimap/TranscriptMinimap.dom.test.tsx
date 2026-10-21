import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { buildMinimapTicks, currentTickAt, messageExcerpt } from './minimapModel'
import { WINDOW_SIZE, windowStart } from './minimapWave'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

function conversation(turns: number) {
  return Array.from({ length: turns }, (_, i) => ({
    id: `m${i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `message ${i} body`,
  }))
}

async function mountMinimap(turns: number, onJump: (rowIndex: number) => void) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { TranscriptMinimap } = await import('./TranscriptMinimap')
  const ticks = buildMinimapTicks(conversation(turns))
  const scrollEl = document.createElement('div')
  scrollEl.append(document.createElement('div'))
  const host = document.createElement('div')
  document.body.append(scrollEl, host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <TranscriptMinimap
        scrollEl={scrollEl}
        ticks={ticks}
        getOffsets={() => ({
          offsets: ticks.map((_, i) => i * 100),
          totalSize: ticks.length * 100,
        })}
        onJump={onJump}
        sessionId="s1"
      />,
    )
  })
  return {
    host,
    act,
    dispose: async () => {
      await act(async () => root.unmount())
      host.remove()
      scrollEl.remove()
    },
  }
}

describe('transcript minimap', () => {
  test('renders one labeled tick per USER message', async () => {
    const { host, dispose } = await mountMinimap(10, () => {})
    try {
      const rail = host.querySelector('[data-slot="transcript-minimap"]')
      expect(rail?.getAttribute('aria-label')).toBe('Conversation minimap')
      const buttons = host.querySelectorAll('button')
      // The rail maps what you ASKED: 10 alternating turns are 5 user messages.
      expect(buttons.length).toBe(5)
      // Out of the transcript's tab order: pointer-only chrome.
      expect(buttons[3]?.tabIndex).toBe(-1)
      expect(buttons[3]?.getAttribute('aria-label')).toBe('Jump to message 4')
    } finally {
      await dispose()
    }
  })

  test('the rail hangs into the gutter only as far as the gutter exists', async () => {
    const { host, dispose } = await mountMinimap(10, () => {})
    try {
      const rail = host.querySelector<HTMLElement>('[data-slot="transcript-minimap"]')!
      // A fixed negative offset put 22px of content outside the scroll box whenever the prose
      // column filled the pane, and the transcript grew a horizontal scrollbar. The offset is the
      // REAL gutter (scroll-container width minus column width), capped at the rail width.
      expect(rail.className).toContain('right-[max(-22px,calc((100%-100cqw)/2))]')
      expect(rail.style.right).toBe('')
    } finally {
      await dispose()
    }
  })

  test('hovering a tick reveals the frosted preview with the excerpt', async () => {
    const { host, act, dispose } = await mountMinimap(10, () => {})
    try {
      expect(host.querySelector('[data-slot="transcript-minimap-preview"]')).toBeNull()
      const tick = host.querySelectorAll('button')[2]!
      await act(async () => {
        tick.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      const card = host.querySelector('[data-slot="transcript-minimap-preview"]')
      // Every tick IS a user message, so the card carries the text alone — no role label.
      expect(card?.textContent).toContain('message 4 body')
    } finally {
      await dispose()
    }
  })

  test('clicking a tick jumps to that transcript row', async () => {
    const jumps: number[] = []
    const { host, act, dispose } = await mountMinimap(10, (rowIndex) => jumps.push(rowIndex))
    try {
      await act(async () => {
        host
          .querySelectorAll('button')[2]!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      // Tick 2 is the third USER message, which is projected row 4.
      expect(jumps).toEqual([4])
    } finally {
      await dispose()
    }
  })

  test('caps the rail at one window, however long the conversation', async () => {
    // 400 turns = 200 user messages; the rail must stay the same physical control.
    const { host, dispose } = await mountMinimap(400, () => {})
    try {
      expect(host.querySelectorAll('button').length).toBe(WINDOW_SIZE)
    } finally {
      await dispose()
    }
  })

  test('the window slides to keep the read position inside it', () => {
    // Early on it is pinned to the start; mid-conversation it centres; at the end it stops.
    expect(windowStart(0, 200)).toBe(0)
    expect(windowStart(100, 200)).toBe(100 - Math.floor(WINDOW_SIZE / 2))
    expect(windowStart(199, 200)).toBe(200 - WINDOW_SIZE)
    // A conversation shorter than the window never slides.
    expect(windowStart(3, 10)).toBe(0)
  })

  test('stays hidden below the message-count threshold', async () => {
    // 6 turns = 3 user messages, one under MINIMAP_MIN_MESSAGES.
    const { host, dispose } = await mountMinimap(6, () => {})
    try {
      expect(host.querySelector('[data-slot="transcript-minimap"]')).toBeNull()
    } finally {
      await dispose()
    }
  })
})

describe('minimap model', () => {
  test('ticks keep only user messages, with their projected row indices', () => {
    const ticks = buildMinimapTicks([
      { id: 'a', role: 'user', content: 'hi' },
      { id: 'n', role: 'system', content: 'notice' },
      { id: 'b', role: 'assistant', content: 'reply' },
      { id: 'd', role: 'user', content: 'divider', uiOnly: true },
      { id: 'c', role: 'user', content: 'again' },
    ])
    expect(ticks.map((tick) => [tick.id, tick.index])).toEqual([
      ['a', 0],
      ['c', 4],
    ])
  })

  test('excerpt collapses whitespace; current marker tracks the reading line', () => {
    expect(messageExcerpt('  a\n\n b\tc  ')).toBe('a b c')
    expect(currentTickAt([0, 100, 200], 0, 90)).toBe(0)
    expect(currentTickAt([0, 100, 200], 180, 90)).toBe(2)
  })
})
