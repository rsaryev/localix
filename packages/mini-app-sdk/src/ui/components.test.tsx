import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { bindMiniAppUiComponents, Input, type MiniAppUiComponents } from './components'

function componentsRendering(label: string): MiniAppUiComponents {
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

describe('bindMiniAppUiComponents', () => {
  test('ending a binding restores the one it shadowed instead of leaving nothing bound', () => {
    const unbindHost = bindMiniAppUiComponents(componentsRendering('host'))
    const unbindDouble = bindMiniAppUiComponents(componentsRendering('double'))
    expect(renderToStaticMarkup(createElement(Input))).toBe('<span>double</span>')

    unbindDouble()
    expect(renderToStaticMarkup(createElement(Input))).toBe('<span>host</span>')

    // An unbind of a binding a newer one already replaced changes nothing.
    const unbindLater = bindMiniAppUiComponents(componentsRendering('later'))
    unbindDouble()
    expect(renderToStaticMarkup(createElement(Input))).toBe('<span>later</span>')
    unbindLater()
    unbindHost()
  })
})
