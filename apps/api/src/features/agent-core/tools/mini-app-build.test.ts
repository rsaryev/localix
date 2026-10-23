import { expect, test } from 'bun:test'

import { createMiniAppBuildTool } from './mini-app-build'

test('mini_app_build is external for every call: it runs a build and reloads host code', () => {
  const tool = createMiniAppBuildTool({ run: async () => ({ text: '', ok: true }) })
  expect(tool.mutates).toBe(true)
  for (const input of [{ name: 'gpu-monitor' }, { name: 'x', description: 'new' }, undefined]) {
    expect(tool.classify?.(input)).toEqual({ effect: 'external' })
  }
})
