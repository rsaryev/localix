import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { registerDom } from '@localixai/kit/testing'
import { handleResourceTabKeyDown } from './resourceTabs'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(() => teardown())

describe('resource tab keyboard navigation', () => {
  test('moves focus and selection together, including wraparound', () => {
    const tablist = document.createElement('div')
    const tabs = ['containers', 'images', 'volumes', 'networks'].map((name) => {
      const tab = document.createElement('button')
      tab.setAttribute('role', 'tab')
      tab.textContent = name
      tablist.append(tab)
      return tab
    })
    document.body.append(tablist)
    tabs[3]!.focus()
    let selected = 'networks'
    let prevented = false

    handleResourceTabKeyDown(
      {
        key: 'ArrowRight',
        target: tabs[3],
        currentTarget: tablist,
        preventDefault: () => {
          prevented = true
        },
      } as unknown as ReactKeyboardEvent<HTMLElement>,
      ['containers', 'images', 'volumes', 'networks'],
      selected,
      (next) => {
        selected = next
      },
    )

    expect(prevented).toBe(true)
    expect(selected).toBe('containers')
    expect(document.activeElement).toBe(tabs[0])
    tablist.remove()
  })

  test('supports Home and End without swallowing unrelated keys', () => {
    const tablist = document.createElement('div')
    const tabs = ['pods', 'services', 'nodes'].map((name) => {
      const tab = document.createElement('button')
      tab.setAttribute('role', 'tab')
      tab.textContent = name
      tablist.append(tab)
      return tab
    })
    document.body.append(tablist)
    tabs[1]!.focus()
    let selected = 'services'
    let prevented = 0
    const press = (key: string) =>
      handleResourceTabKeyDown(
        {
          key,
          target: document.activeElement,
          currentTarget: tablist,
          preventDefault: () => {
            prevented += 1
          },
        } as unknown as ReactKeyboardEvent<HTMLElement>,
        ['pods', 'services', 'nodes'],
        selected,
        (next) => {
          selected = next
        },
      )

    press('End')
    expect(selected).toBe('nodes')
    expect(document.activeElement).toBe(tabs[2])
    press('Home')
    expect(selected).toBe('pods')
    expect(document.activeElement).toBe(tabs[0])
    press('Enter')
    expect(prevented).toBe(2)
    tablist.remove()
  })
})
