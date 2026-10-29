import { afterEach, describe, expect, test } from 'bun:test'

import { syncThirdPartyViews, __resetThirdPartyViews } from '@/shared/contrib/runtimeViews'
import { buildThirdPartyViewCommands } from './thirdPartyViewCommands'
import type { MiniAppViewSpec } from '@/shared/api/contracts'

/**
 * Palette commands for installed third-party views: one "Open …" entry per enabled
 * view, appearing/disappearing with the runtime-views store exactly like the rail
 * buttons (the enable/disable contract).
 */

const view = (app: string, id: string): MiniAppViewSpec => ({
  app,
  projectId: '',
  id,
  fullName: `${app}:${id}`,
  title: id,
})

const noopOpeners = { openWorkItem: () => {} }

afterEach(() => __resetThirdPartyViews())

describe('buildThirdPartyViewCommands', () => {
  test('every view yields one "Open …" command in the View group', () => {
    syncThirdPartyViews([view('mon', 'dash'), view('mon', 'panel')])
    const cmds = buildThirdPartyViewCommands(noopOpeners)
    expect(cmds.map((c) => c.label)).toEqual(['Open dash', 'Open panel'])
    expect(cmds.every((c) => c.group === 'View')).toBe(true)
    expect(cmds.map((c) => c.id)).toEqual(['view.mini-app.mon:dash', 'view.mini-app.mon:panel'])
  })

  test('the command DISAPPEARS when its mini app drops out of a later sync (disable)', () => {
    syncThirdPartyViews([view('mon', 'dash')])
    expect(buildThirdPartyViewCommands(noopOpeners)).toHaveLength(1)
    // Disable: the mini app is gone from the next enabled set.
    syncThirdPartyViews([])
    expect(buildThirdPartyViewCommands(noopOpeners)).toHaveLength(0)
  })

  test('running a command opens its tab with the id its rail button uses', () => {
    syncThirdPartyViews([view('mon', 'panel')])
    const opened: unknown[] = []
    const cmds = buildThirdPartyViewCommands({ openWorkItem: (input) => opened.push(input) })
    cmds.find((c) => c.label === 'Open panel')!.run()
    expect(opened).toEqual([
      {
        miniAppName: 'mon',
        projectId: '',
        viewId: 'panel',
        fullName: 'mon:panel',
        title: 'panel',
      },
    ])
  })
})
