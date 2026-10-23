import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { bindPluginUiComponents, Input, type PluginUiComponents } from './components'
import { bindPluginUiToast, toast, type PluginToast } from './notifications'
import { bindPluginUiTestDoubles } from './testing'

describe('bindPluginUiTestDoubles', () => {
  // The defect: a suite's doubles outlived it in the combined `bun test plugins` process, so the
  // next plugin's real grid rendered as the stub. Ending the doubles must hand back BOTH the host
  // components and the host toast the suite shadowed.
  test('its unbind restores the components and toast it shadowed', () => {
    const hostInput = () => createElement('span', null, 'host')
    const nothing = () => null
    const host: PluginUiComponents = {
      FileTab: nothing,
      TableGrid: nothing,
      ContextBindingIcon: nothing,
      ContextBindingPreview: nothing,
      Input: hostInput,
      Textarea: nothing,
      ProblemLine: nothing,
      ProblemState: nothing,
    }
    const unbindHost = bindPluginUiComponents(host)
    const shown: string[] = []
    const record = (message: string) => void shown.push(message)
    const unbindHostToast = bindPluginUiToast(
      Object.assign(record, {
        success: record,
        error: record,
        info: record,
        warning: record,
        message: record,
        problems: () => undefined,
        problemsCleared: () => undefined,
      }) as unknown as PluginToast,
    )

    const unbindDoubles = bindPluginUiTestDoubles()
    expect(renderToStaticMarkup(createElement(Input))).toBe('')
    toast.info('swallowed by the double')

    unbindDoubles()
    expect(renderToStaticMarkup(createElement(Input))).toBe('<span>host</span>')
    toast.info('reaches the host')
    expect(shown).toEqual(['reaches the host'])

    unbindHostToast()
    unbindHost()
  })
})
