import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

const PARTICIPANTS = [
  { agentId: 'builtin:localix', handle: 'localix' },
  { agentId: 'builtin:frontend', handle: 'frontend' },
  { agentId: 'builtin:qa', handle: 'qa' },
]

async function render(
  floor: { speaking: string | null; waiting: string[] } | null,
  extra: Record<string, unknown> = {},
) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { ParticipantsStrip } = await import('./ParticipantsStrip')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      React.createElement(ParticipantsStrip, { participants: PARTICIPANTS, floor, ...extra }),
    )
  })
  return {
    host,
    rerender: async (
      nextFloor: { speaking: string | null; waiting: string[] } | null,
      nextExtra: Record<string, unknown> = {},
    ) => {
      await act(async () => {
        root.render(
          React.createElement(ParticipantsStrip, {
            participants: PARTICIPANTS,
            floor: nextFloor,
            ...nextExtra,
          }),
        )
      })
    },
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('ParticipantsStrip — the live order drawn onto the participants', () => {
  test('renders flat compact idle names and keeps long names bounded without losing their label', async () => {
    const handle = 'a-participant-with-a-very-long-display-name'
    const { host, cleanup } = await render(null, {
      participants: [{ agentId: 'custom:long', handle }],
      sessionId: 'compact-roster',
    })
    try {
      expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
        'Conversation participants',
      )
      const chip = host.querySelector<HTMLElement>('[data-slot="participant-chip"]')!
      expect(chip.className).toContain('h-[var(--chrome-control-sm)]')
      expect(chip.className).toContain('bg-transparent')
      expect(chip.className).not.toContain('bg-surface-raised')
      expect(chip.className).not.toContain('shadow-')
      const mention = chip.querySelector('button')!
      expect(mention.getAttribute('title')).toBe(`Mention @${handle}`)
      expect(mention.getAttribute('aria-label')).toContain('Mention in the message')
      expect(mention.querySelector('.truncate')?.className).toContain('max-w-32')
    } finally {
      await cleanup()
    }
  })

  test('removes a waiting or idle participant without staging a mention', async () => {
    const removed: string[] = []
    const { composerBus } = await import('@/shared/lib/composerBus')
    const staged: string[] = []
    const off = composerBus.subscribe((request) => {
      staged.push(request.text ?? '')
      return true
    })
    const { host, cleanup } = await render(
      { speaking: 'builtin:frontend', waiting: ['builtin:qa'] },
      {
        sessionId: 'remove-roster',
        onRemove: (id: string) => removed.push(id),
      },
    )
    try {
      const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove Qa"]')!
      expect(remove.className).toContain('size-[var(--chrome-control-xs)]')
      expect(remove.className).not.toContain('opacity-0')
      expect(remove.className).toContain('focus-ring')
      const { act } = await import('react')
      await act(async () => remove.click())
      expect(removed).toEqual(['builtin:qa'])
      expect(staged).toEqual([])
      expect(host.querySelector('button[aria-label="Remove Frontend"]')).toBeNull()
    } finally {
      off()
      await cleanup()
    }
  })

  test('an empty roster retains its membership controls and a read-only roster has no removal', async () => {
    const { createElement } = await import('react')
    const { host, rerender, cleanup } = await render(null, {
      participants: [],
      addControl: createElement('button', { 'aria-label': 'Add participant' }),
    })
    try {
      expect(host.querySelector('[data-slot="participant-chip"]')).toBeNull()
      expect(host.querySelector('button[aria-label="Add participant"]')).not.toBeNull()
      await rerender(null)
      expect(host.querySelectorAll('[data-slot="participant-chip"]')).toHaveLength(3)
      expect(host.querySelector('button[aria-label^="Remove"]')).toBeNull()
      expect(host.querySelector('button[title^="Mention"]')?.hasAttribute('disabled')).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('shows elapsed time only during a stream and resets when the speaker or stream changes', async () => {
    const originalNow = Date.now
    let clock = 100_000
    Date.now = () => clock
    const localix = { speaking: 'builtin:localix', waiting: [] }
    const frontend = { speaking: 'builtin:frontend', waiting: [] }
    const { host, rerender, cleanup } = await render(localix, {
      sessionId: 'timer-test',
      isGenerating: true,
    })
    try {
      expect(host.textContent).toContain('Localix0sec')
      clock += 63_000
      const { act } = await import('react')
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1010))
      })
      expect(host.textContent).toContain('Localix1m3sec')

      await rerender(frontend, { sessionId: 'timer-test', isGenerating: true })
      expect(host.textContent).toContain('Frontend0sec')
      expect(host.textContent).not.toContain('Localix1m3sec')

      await rerender(frontend, { sessionId: 'timer-test', isGenerating: false })
      expect(host.textContent).not.toContain('sec')
      clock += 5000
      await rerender(frontend, { sessionId: 'timer-test', isGenerating: true })
      expect(host.textContent).toContain('Frontend0sec')
    } finally {
      Date.now = originalNow
      await cleanup()
    }
  })

  test('returning to an active session keeps its elapsed time', async () => {
    const { answerClock } = await import('../../model/answerClock')
    const originalNow = Date.now
    let clock = 200_000
    Date.now = () => clock
    const localix = { speaking: 'builtin:localix', waiting: [] }
    const first = await render(localix, { sessionId: 'first', isGenerating: true })
    try {
      clock += 63_000
      await first.rerender(null, { sessionId: 'second', isGenerating: false })
      await first.rerender(localix, { sessionId: 'first', isGenerating: true })
      expect(first.host.textContent).toContain('Localix1m3sec')

      // A new run in the same session and by the same agent is a fresh clock.
      answerClock.start('first', 'builtin:localix', clock)
      await first.rerender(localix, { sessionId: 'second', isGenerating: true })
      await first.rerender(localix, { sessionId: 'first', isGenerating: true })
      expect(first.host.textContent).toContain('Localix0sec')
    } finally {
      answerClock.end('first')
      answerClock.end('second')
      Date.now = originalNow
      await first.cleanup()
    }
  })

  test('the participant speaking wears the composer’s beam, and only it does', async () => {
    // A conversation answers one participant at a time and a turn costs a model call, so the
    // strip has to say which of them the minutes are going to. One beam, so there is one thing
    // to look at.
    const { host, cleanup } = await render({
      speaking: 'builtin:frontend',
      waiting: ['builtin:qa'],
    })
    try {
      // Both queued and speaking participants carry the beam; the SPEAKER is the bright one, and
      // there is exactly one of those.
      const bright = host.querySelectorAll(
        '.lx-border-beam[data-active="true"][data-intensity="4"]',
      )
      expect(bright).toHaveLength(1)
      const chip = bright[0]!.parentElement!
      expect(chip.textContent).toContain('Frontend')
      expect(chip.className).toContain('bg-transparent')
      expect(chip.className).not.toContain('bg-surface-active')
      expect(chip.querySelector('button')?.getAttribute('aria-label')).toContain('answering now')
      // The one waiting is marked by the same primitive, turned down.
      expect(
        host.querySelectorAll('.lx-border-beam[data-active="true"][data-intensity="1"]'),
      ).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  test('a participant queued behind carries its place in line', async () => {
    const { host, cleanup } = await render({
      speaking: 'builtin:frontend',
      waiting: ['builtin:qa', 'builtin:localix'],
    })
    try {
      const labels = [...host.querySelectorAll('[aria-label]')].map(
        (node) => node.getAttribute('aria-label') ?? '',
      )
      expect(labels.some((label) => label.startsWith('Qa, number 1 in line'))).toBe(true)
      expect(labels.some((label) => label.startsWith('Localix, number 2 in line'))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('between rounds nobody is marked and nothing animates', async () => {
    const { host, cleanup } = await render(null)
    try {
      expect(host.querySelectorAll('.lx-border-beam[data-active="true"]')).toHaveLength(0)
      expect(host.textContent).toContain('Localix')
    } finally {
      await cleanup()
    }
  })

  test('clicking a participant stages its handle in this session’s composer', async () => {
    // Naming someone is what gives them the floor, so the roster is also the control for
    // addressing it: seeing an idle colleague is exactly when a person wants their handle.
    const { composerBus } = await import('@/shared/lib/composerBus')
    const staged: { text: string; inline?: boolean; sessionId: string }[] = []
    const off = composerBus.subscribe((request) => {
      staged.push({
        text: request.text ?? '',
        inline: request.inline,
        sessionId: request.sessionId,
      })
      return true
    })
    const { host, cleanup } = await render(null, { sessionId: 'strip-session' })
    try {
      const button = [...host.querySelectorAll('button')].find((node) =>
        node.getAttribute('title')?.includes('@qa'),
      )!
      const React = await import('react')
      await React.act(async () => {
        button.click()
      })
      // A trailing space and an INLINE seam, because the sentence continues where the person
      // left off — handles stacked as paragraphs made a column instead of an address line.
      // Addressed to THIS strip's session: an insert reaches only the composer of the chat it names.
      expect(staged).toEqual([{ text: '@qa ', inline: true, sessionId: 'strip-session' }])
    } finally {
      off()
      await cleanup()
    }
  })

  test('the participant mid-turn cannot be removed out from under its own run', async () => {
    const { host, cleanup } = await render({ speaking: 'builtin:frontend', waiting: [] })
    try {
      const removals = [...host.querySelectorAll('button[aria-label^="Remove"]')].map((node) =>
        node.getAttribute('aria-label'),
      )
      expect(removals).not.toContain('Remove Frontend')
      // The orchestrator is in every conversation by construction, so it has no remove control
      // either.
      expect(removals).not.toContain('Remove Localix')
      // Its chip keeps the button's width anyway, so the row stays on one line. Every participant
      // ends with an element of that size, removable or not.
      for (const beam of host.querySelectorAll('.lx-border-beam')) {
        const chip = beam.parentElement!
        expect(chip.lastElementChild?.className).toContain('size-[var(--chrome-control-xs)]')
      }
    } finally {
      await cleanup()
    }
  })
})

describe('ParticipantsStrip — a fixed roster', () => {
  const React = () => import('react')

  // The server refuses any change to a fixed roster; a control that can only fail is a lie.
  test('offers neither adding nor removing, and the idle participants recede into grey', async () => {
    const { createElement } = await React()
    const { host, cleanup } = await render(
      { speaking: 'builtin:frontend', waiting: [] },
      {
        locked: true,
        onRemove: () => {},
        addControl: createElement('button', { 'aria-label': 'Add participant' }),
        lockControl: createElement('span', { 'data-testid': 'lock' }),
      },
    )
    try {
      expect(host.querySelector('button[aria-label^="Remove"]')).toBeNull()
      expect(host.querySelector('button[aria-label="Add participant"]')).toBeNull()
      expect(host.querySelector('[data-testid="lock"]')).not.toBeNull()
      const chips = [...host.querySelectorAll('.lx-border-beam')].map((beam) => beam.parentElement!)
      const speaker = chips.find((chip) => chip.textContent?.includes('Frontend'))!
      // Live work must never look paused: the speaker keeps its colour.
      expect(speaker.className).not.toContain('grayscale')
      expect(chips.filter((chip) => chip.className.includes('grayscale'))).toHaveLength(2)
    } finally {
      await cleanup()
    }
  })

  test('an open roster keeps its controls and its colour', async () => {
    const { createElement } = await React()
    const { host, cleanup } = await render(null, {
      onRemove: () => {},
      addControl: createElement('button', { 'aria-label': 'Add participant' }),
    })
    try {
      expect(host.querySelector('button[aria-label="Add participant"]')).not.toBeNull()
      expect(host.querySelectorAll('button[aria-label^="Remove"]').length).toBeGreaterThan(0)
      expect(host.querySelector('.grayscale')).toBeNull()
    } finally {
      await cleanup()
    }
  })
})

describe('ParticipantsStrip — the row stays still', () => {
  const order = (host: HTMLElement) =>
    [...host.querySelectorAll('[data-participant]')].map((node) =>
      node.getAttribute('data-participant'),
    )
  const ROSTER = ['builtin:localix', 'builtin:frontend', 'builtin:qa']

  test('roster order holds while speakers change and rounds end', async () => {
    const { host, rerender, cleanup } = await render(
      { speaking: 'builtin:qa', waiting: ['builtin:frontend'] },
      { sessionId: 'order-still' },
    )
    try {
      expect(order(host)).toEqual(ROSTER)
      await rerender({ speaking: 'builtin:frontend', waiting: [] }, { sessionId: 'order-still' })
      expect(order(host)).toEqual(ROSTER)
      await rerender(null, { sessionId: 'order-still' })
      expect(order(host)).toEqual(ROSTER)
    } finally {
      await cleanup()
    }
  })

  test('the place in line rides on the avatar, not beside the name', async () => {
    const { host, cleanup } = await render(
      { speaking: 'builtin:qa', waiting: ['builtin:frontend'] },
      { sessionId: 'order-badge' },
    )
    try {
      const chip = host.querySelector('[data-participant="builtin:frontend"]')!
      const badge = [...chip.querySelectorAll('span.absolute')].find((n) => n.textContent === '1')
      expect(badge).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  test('the speaker is centred in a scrolled row, without moving any chip', async () => {
    const { host, rerender, cleanup } = await render(null, { sessionId: 'order-scroll' })
    try {
      const scroller = host.querySelector('[data-participant]')!.parentElement!
      const scrolls: ScrollToOptions[] = []
      scroller.scrollTo = ((options: ScrollToOptions) =>
        scrolls.push(options)) as typeof scroller.scrollTo
      const qa = host.querySelector<HTMLElement>('[data-participant="builtin:qa"]')!
      qa.getBoundingClientRect = () => ({ left: 300, width: 80 }) as DOMRect
      scroller.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
      Object.defineProperty(scroller, 'clientWidth', { value: 200, configurable: true })
      Object.defineProperty(scroller, 'scrollWidth', { value: 600, configurable: true })
      await rerender({ speaking: 'builtin:qa', waiting: [] }, { sessionId: 'order-scroll' })
      expect(scrolls).toHaveLength(1)
      // Chip at 300–380 in a 200px view: centred means its middle (340) at the view's middle.
      expect(scrolls[0]!.left).toBe(240)
      expect(order(host)).toEqual(ROSTER)
    } finally {
      await cleanup()
    }
  })
})

test('the active participant has a timer while idle and waiting participants show usage', async () => {
  const { host, rerender, cleanup } = await render(
    { speaking: 'builtin:frontend', waiting: ['builtin:qa'] },
    { sessionId: 'usage-roster', isGenerating: true },
  )
  try {
    expect(host.querySelector('[aria-label="Usage for Frontend"]')).toBeNull()
    expect(host.querySelector('[aria-label="Usage for Qa"]')).not.toBeNull()
    expect(host.querySelector('[data-participant="builtin:frontend"]')?.textContent).toMatch(/\d/)
    await rerender(null, { sessionId: 'usage-roster', isGenerating: false })
    expect(host.querySelectorAll('[aria-label^="Usage for"]')).toHaveLength(3)
  } finally {
    await cleanup()
  }
})

test('the roster contains participants without a session-wide usage control', async () => {
  const { host, cleanup } = await render(
    { speaking: 'builtin:qa', waiting: [] },
    { sessionId: 'usage-total' },
  )
  try {
    const group = host.querySelector('[aria-label="Conversation participants"]')!
    expect(group.querySelector('[aria-label="Total session usage"]')).toBeNull()
    expect(group.querySelectorAll('[data-slot="participant-chip"]')).toHaveLength(3)
  } finally {
    await cleanup()
  }
})
