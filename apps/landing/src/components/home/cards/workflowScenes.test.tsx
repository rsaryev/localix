import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrowserScene, ContextScene, PluginScene } from './workflowScenes'

for (const [name, Scene, workClass] of [
  ['plugin', PluginScene, 'sc-plugin-view'],
  ['browser', BrowserScene, 'sc-page'],
  ['context', ContextScene, 'sc-code'],
] as const) {
  test(`${name}: the working pane precedes the right-hand session`, () => {
    const markup = renderToStaticMarkup(<Scene />)
    expect(markup).toContain('sc-workbench')
    expect(markup.indexOf(`class="${workClass}`)).toBeLessThan(markup.indexOf('class="sc-session'))
    expect(markup).toContain('sc-session-label')
  })
}

test('the plugin tab appears on the working side without retargeting the session animation', () => {
  const markup = renderToStaticMarkup(<PluginScene />)
  expect(markup.indexOf('sc-plugin-tab')).toBeLessThan(markup.indexOf('sc-plugin-session-tab'))
  expect(markup).toContain('sc-plugin-ask')
  expect(markup).toContain('sc-build-done')
})

for (const [name, Scene] of [
  ['browser', BrowserScene],
  ['context', ContextScene],
] as const) {
  test(`${name}: the flight source stays in the tool and its destination in the session`, () => {
    const markup = renderToStaticMarkup(<Scene />)
    const session = markup.indexOf('class="sc-session')
    expect(markup.indexOf('data-fly-from')).toBeLessThan(session)
    expect(markup.indexOf('data-fly-to')).toBeGreaterThan(session)
  })
}
