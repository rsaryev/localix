import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, Fragment } from 'react'
import { TabPanel, TabStrip } from './tabs'

const source = readFileSync(new URL('./tab-bar.tsx', import.meta.url), 'utf8')

test('tab content and its active underline switch atomically', () => {
  expect(source).not.toContain('transition-[transform,width]')
  expect(source).not.toContain('indicatorReady')
  expect(source).toContain('useLayoutEffect(() =>')
})

test('tabs and keep-alive panels expose a complete accessible relationship', () => {
  const html = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(TabStrip, {
        'aria-label': 'Editor group',
        items: [
          { id: 'a', label: 'First', tabId: 'tab-a', panelId: 'panel-a' },
          { id: 'b', label: 'Second', tabId: 'tab-b', panelId: 'panel-b' },
        ],
        activeId: 'a',
        onChange: () => {},
      }),
      createElement(
        TabPanel,
        { id: 'panel-a', 'aria-labelledby': 'tab-a', active: true },
        'First panel',
      ),
      createElement(
        TabPanel,
        { id: 'panel-b', 'aria-labelledby': 'tab-b', active: false },
        'Warm background panel',
      ),
    ),
  )

  expect(html).toContain('role="tablist"')
  expect(html).toContain('aria-label="Editor group"')
  expect(html).toContain('id="tab-a"')
  expect(html).toContain('aria-controls="panel-a"')
  expect(html).toContain('role="tabpanel"')
  expect(html).toContain('aria-labelledby="tab-a"')
  expect(html).toContain('id="panel-b"')
  expect(html).toContain('hidden=""')
})

test('keeps fixed tab actions outside the tablist in their own named group', () => {
  const html = renderToStaticMarkup(
    createElement(TabStrip, {
      'aria-label': 'Editor tabs',
      actionsLabel: 'Editor tab actions',
      actions: createElement('button', { type: 'button' }, 'New terminal'),
      items: [{ id: 'terminal', label: 'Terminal' }],
      activeId: 'terminal',
      onChange: () => {},
    }),
  )

  expect(html).toContain('data-slot="tab-strip"')
  expect(html).toContain('data-slot="tab-strip-list"')
  expect(html).toContain('role="group" aria-label="Editor tab actions"')
})
