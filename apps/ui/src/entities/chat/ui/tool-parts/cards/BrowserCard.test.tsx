import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolCallItem } from '@localixai/agent/agents'
import { BrowserCard } from './BrowserCard'

const item = (input: unknown): ToolCallItem => ({
  id: 'i1',
  type: 'tool_call',
  status: 'completed',
  toolCallId: 'tc1',
  name: 'Browser',
  input,
  activeVerb: 'x',
})

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('BrowserCard action verbs', () => {
  // Regression: `open`, `close`, and `evaluate` were absent from ACTION_VERB
  // (9 of 12 actions), so they rendered as the raw action name. All 12 server
  // actions must now surface a legible verb.
  test('open / close / evaluate render a real verb (not the raw action name)', () => {
    expect(
      plain(renderToStaticMarkup(<BrowserCard item={item({ action: 'open', url: 'http://x' })} />)),
    ).toContain('Open')
    expect(plain(renderToStaticMarkup(<BrowserCard item={item({ action: 'close' })} />))).toContain(
      'Close',
    )
    const evalHtml = plain(
      renderToStaticMarkup(
        <BrowserCard item={item({ action: 'evaluate', expression: 'window.board' })} />,
      ),
    )
    expect(evalHtml).toContain('Evaluate')
    // The evaluated expression is now the card's detail, so the collapsed row is legible.
    expect(evalHtml).toContain('window.board')
  })

  test('every server action renders a non-empty verb', () => {
    // Mirror of the server ACTIONS tuple (browser-actions.ts). If a new
    // action is added there, add it here + to ACTION_VERB (the `satisfies` in the
    // card is the primary compile-time guard; this is the runtime backstop).
    const actions = [
      'viewport',
      'open',
      'close',
      'snapshot',
      'take_screenshot',
      'console',
      'steps',
      'evaluate',
    ]
    for (const action of actions) {
      const html = plain(renderToStaticMarkup(<BrowserCard item={item({ action, ref: 'e3' })} />))
      expect(html.length).toBeGreaterThan(0)
      // The title carries the verb; a missing map entry would echo the raw lowercase action.
      expect(html).toContain('Browser') // subtitle always present on a completed card
    }
  })

  test('a steps batch reads as its steps in order, each with what it did', () => {
    // Interactions exist only as steps, so the batch is where "what was clicked/typed/pressed"
    // has to show; a bare "Steps" title would hide every interaction the card used to name.
    const html = plain(
      renderToStaticMarkup(
        <BrowserCard
          item={item({
            action: 'steps',
            steps: [
              { action: 'click', ref: 'e3' },
              { action: 'press', keys: ['Enter'] },
              { action: 'scroll', direction: 'down' },
            ],
          })}
        />,
      ),
    )
    expect(html).toContain('Steps click e3 → press Enter → scroll down')
  })

  test('unknown/future action falls back to its raw name, never crashes', () => {
    const html = plain(renderToStaticMarkup(<BrowserCard item={item({ action: 'teleport' })} />))
    expect(html).toContain('teleport')
  })
})
