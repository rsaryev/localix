import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { bindPluginUiComponents, Input, type PluginUiComponents } from './components'

function componentsRendering(label: string): PluginUiComponents {
  const nothing = () => null
  return {
    FileTab: nothing,
    TableGrid: nothing,
    ContextBindingIcon: nothing,
    ContextBindingPreview: nothing,
    Input: () => createElement('span', null, label),
    Textarea: nothing,
    ProblemLine: nothing,
    ProblemState: nothing,
  }
}

describe('bindPluginUiComponents', () => {
  test('ending a binding restores the one it shadowed instead of leaving nothing bound', () => {
    const unbindHost = bindPluginUiComponents(componentsRendering('host'))
    const unbindDouble = bindPluginUiComponents(componentsRendering('double'))
    expect(renderToStaticMarkup(createElement(Input))).toBe('<span>double</span>')

    unbindDouble()
    expect(renderToStaticMarkup(createElement(Input))).toBe('<span>host</span>')

    // An unbind of a binding a newer one already replaced changes nothing.
    const unbindLater = bindPluginUiComponents(componentsRendering('later'))
    unbindDouble()
    expect(renderToStaticMarkup(createElement(Input))).toBe('<span>later</span>')
    unbindLater()
    unbindHost()
  })
})
