import { afterAll, expect, test } from 'bun:test'
import { defaultClientConditions, type UserConfig } from 'vite'

import defineLocalixConfig from '../vite.config'

const previousApiTarget = process.env.VITE_API_BASE_URL
process.env.VITE_API_BASE_URL = 'http://127.0.0.1:1'
afterAll(() => {
  if (previousApiTarget === undefined) delete process.env.VITE_API_BASE_URL
  else process.env.VITE_API_BASE_URL = previousApiTarget
})

const resolveConfig = (command: 'serve' | 'build') =>
  (defineLocalixConfig as (env: { command: string; mode: string }) => UserConfig)({
    command,
    mode: command === 'serve' ? 'development' : 'production',
  })

test('the dev server reads workspace packages from source, so a package build never reloads it', () => {
  expect(resolveConfig('serve').resolve?.conditions).toEqual([
    ...defaultClientConditions,
    '@localixai/source',
  ])
})

test('a build keeps resolving the published exports', () => {
  expect(resolveConfig('build').resolve?.conditions).toBeUndefined()
})

test('pre-bundles the process shim, which otherwise is found late and reloads the open page', () => {
  expect(resolveConfig('serve').optimizeDeps?.include).toContain(
    'vite-plugin-node-polyfills/shims/process',
  )
})
