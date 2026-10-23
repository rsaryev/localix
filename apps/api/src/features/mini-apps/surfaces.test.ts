import { describe, expect, test } from 'bun:test'
import {
  MINI_APP_SURFACE_AGENT,
  MINI_APP_SURFACE_WORKBENCH,
  isWorkbenchMiniApp,
  normalizeMiniAppSurfaces,
} from './contracts-base'

describe('normalizeMiniAppSurfaces', () => {
  test('absent/empty declaration falls back to the agent surface', () => {
    expect(normalizeMiniAppSurfaces(undefined)).toEqual([MINI_APP_SURFACE_AGENT])
    expect(normalizeMiniAppSurfaces(null)).toEqual([MINI_APP_SURFACE_AGENT])
    expect(normalizeMiniAppSurfaces([])).toEqual([MINI_APP_SURFACE_AGENT])
    expect(normalizeMiniAppSurfaces(['  ', ''])).toEqual([MINI_APP_SURFACE_AGENT])
  })

  test('trims, lower-cases and de-dupes', () => {
    expect(normalizeMiniAppSurfaces([' Workbench ', 'workbench', 'AGENT'])).toEqual([
      'workbench',
      'agent',
    ])
  })

  test('carries an UNKNOWN surface through instead of rejecting it', () => {
    // A future host can give a new surface meaning without a manifest migration.
    expect(normalizeMiniAppSurfaces(['terminal'])).toEqual(['terminal'])
  })
})

describe('isWorkbenchMiniApp', () => {
  test('true only when the workbench surface is declared', () => {
    expect(isWorkbenchMiniApp([MINI_APP_SURFACE_WORKBENCH])).toBe(true)
    // A workbench mini app that ALSO ships agent tools still belongs to the workbench bucket.
    expect(isWorkbenchMiniApp([MINI_APP_SURFACE_AGENT, MINI_APP_SURFACE_WORKBENCH])).toBe(true)
    expect(isWorkbenchMiniApp([MINI_APP_SURFACE_AGENT])).toBe(false)
    expect(isWorkbenchMiniApp(undefined)).toBe(false)
    expect(isWorkbenchMiniApp(['terminal'])).toBe(false)
  })
})
