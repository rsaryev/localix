// The mini app kit as a developer's only dependency: a mini app outside this repository — in its
// own repository, with no Localix checkout beside it — type-checks, TESTS (DOM tests included) and
// builds from the kit alone. The kit is a package (`@localixai/mini-app-kit`), so it installs from a
// release tarball or links from a staged folder. Each case names the failure it pins.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { kitCacheRoot } from './mini-app-kit-cache.mjs'

const repoRoot = resolve(import.meta.dir, '..')
const KIT_STAGER = join(import.meta.dir, 'stage-mini-app-kit.mjs')
const root = mkdtempSync(join(tmpdir(), 'mini-app-kit-runtime-'))
const kitDir = join(root, 'kit')

function stage(out: string, env: Record<string, string> = {}) {
  const result = spawnSync(
    'bun',
    [KIT_STAGER, repoRoot, out, `--cache=${kitCacheRoot(repoRoot)}`],
    {
      encoding: 'utf8',
      timeout: 120_000,
      killSignal: 'SIGKILL',
      env: { ...process.env, ...env },
    },
  )
  if (result.status !== 0) throw new Error(`staging failed: ${result.stderr}${result.stdout}`)
}

beforeAll(() => stage(kitDir), 130_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

/** A folder outside the repository holding `files`, its tests run with the kit's preload only. */
function runTests(files: Record<string, string>) {
  const dir = mkdtempSync(join(root, 'app-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const preload = join(kitDir, readJson(join(kitDir, 'kit.json')).authoring.testPreload)
  return spawnSync('bun', ['test', '--preload', preload], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  })
}

describe('the kit as a package', () => {
  test('is @localixai/mini-app-kit at the Localix version it was staged from', () => {
    const pkg = readJson(join(kitDir, 'package.json'))
    expect(pkg.name).toBe('@localixai/mini-app-kit')
    expect(pkg.version).toBe(readJson(join(kitDir, 'kit.json')).localixVersion)
  })

  // Bun runs bunfig's preloads before `--preload`: a mini app whose own setup imports the SDK
  // names the kit's preload first, by package name.
  test('exports its test preload by name', () => {
    const pkg = readJson(join(kitDir, 'package.json'))
    const kit = readJson(join(kitDir, 'kit.json'))
    expect(pkg.exports['./test-preload']).toBe(`./${kit.authoring.testPreload}`)
  })

  test('a release stamps its own version into the kit, not the source placeholder', () => {
    const released = join(root, 'released')
    stage(released, { LOCALIX_VERSION: '9.8.7-beta.6' })
    expect(readJson(join(released, 'kit.json')).localixVersion).toBe('9.8.7-beta.6')
    expect(readJson(join(released, 'package.json')).version).toBe('9.8.7-beta.6')
  }, 130_000)
})

describe('a mini app tested from the kit alone', () => {
  test('its tests type-check against the host test harness the kit declares', () => {
    const typePaths = readJson(join(kitDir, 'kit.json')).typePaths
    for (const specifier of [
      '@localixai/kit/testing',
      '@localixai/kit/testing/dom',
      '@localixai/kit/testing/lent-components',
    ]) {
      const file = join(kitDir, typePaths[specifier] ?? 'missing')
      expect(readFileSync(file, 'utf8')).toContain('export')
    }
    const harness = readFileSync(join(kitDir, typePaths['@localixai/kit/testing']), 'utf8')
    expect(harness).toContain('registerDom')
  })

  test('a DOM test renders kit components and reads the host test harness', () => {
    const result = runTests({
      'ui/Hello.dom.test.tsx': `import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Button } from '@localixai/kit/button'
import { registerDom } from '@localixai/kit/testing'
import { act } from 'react'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a kit button renders and answers a click', async () => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  let clicks = 0
  await act(async () => {
    createRoot(host).render(<Button onClick={() => clicks++}>Log</Button>)
  })
  const button = host.querySelector('button')
  expect(button?.textContent).toBe('Log')
  await act(async () => button?.click())
  expect(clicks).toBe(1)
})
`,
    })
    expect(result.stderr).toContain('1 pass')
    expect(result.status).toBe(0)
  })

  // React's \`act\` waits on Node's \`setImmediate\`, found through \`module.require\`. Bundled, React
  // fell back to a MessageChannel that delivers before a frame the render scheduled, so a reader
  // toolbar positioned in \`requestAnimationFrame\` never showed in its test.
  test('act waits for a frame its render scheduled, as React unbundled does', () => {
    const result = runTests({
      'ui/frame.dom.test.tsx': `import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { act, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

function Placed() {
  const [placed, setPlaced] = useState(false)
  useLayoutEffect(() => {
    requestAnimationFrame(() => setPlaced(true))
  }, [])
  return <p>{placed ? 'placed' : 'waiting'}</p>
}

test('a frame scheduled in a layout effect lands inside act', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () => createRoot(host).render(<Placed />))
  expect(host.textContent).toBe('placed')
})
`,
    })
    expect(result.stderr).toContain('1 pass')
    expect(result.status).toBe(0)
  })

  test('icons, the SDK test doubles and React DOM all come from the kit, one React', () => {
    const result = runTests({
      'ui/icons.test.tsx': `import { expect, test } from 'bun:test'
import { Check } from 'lucide-react'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import { renderToStaticMarkup } from 'react-dom/server'

test('an icon renders to markup with the kit React', () => {
  bindMiniAppUiTestDoubles()
  expect(renderToStaticMarkup(<Check />)).toContain('<svg')
})
`,
    })
    expect(result.stderr).toContain('1 pass')
    expect(result.status).toBe(0)
  })

  // A bundled mini app certified its context provider with the host's own contract checks,
  // imported from the host's source tree: outside the repository it could not run at all.
  test('a backend test certifies its context provider against the host contract', () => {
    const result = runTests({
      'backend/context.test.ts': `import { expect, test } from 'bun:test'
import { certifyResolverContribution } from '@localixai/kit/testing/context-contract'

test('the host contract is at hand', () => {
  expect(typeof certifyResolverContribution).toBe('function')
})
`,
    })
    expect(result.stderr).toContain('1 pass')
    expect(result.status).toBe(0)
    const typePaths = readJson(join(kitDir, 'kit.json')).typePaths
    expect(
      readFileSync(join(kitDir, typePaths['@localixai/kit/testing/context-contract']), 'utf8'),
    ).toContain('certifyResolverContribution')
  })

  test('UI logic reads the SDK and the data views the host lends', () => {
    const result = runTests({
      'ui/model.test.ts': `import { expect, test } from 'bun:test'
import * as dataview from '@localixai/dataview'
import * as sdkUi from '@localixai/mini-app-sdk/ui'

test('the lent modules load', () => {
  expect(Object.keys(dataview).length).toBeGreaterThan(0)
  expect(Object.keys(sdkUi).length).toBeGreaterThan(0)
})
`,
    })
    expect(result.stderr).toContain('1 pass')
    expect(result.status).toBe(0)
  })
})

describe('a mini app built from the kit alone', () => {
  test('a module the host does not serve is bundled from the kit, and assets have types', () => {
    const kit = readJson(join(kitDir, 'kit.json'))
    expect(Object.keys(kit.bundledModules)).toContain('@localixai/mini-app-sdk/agent-wait')
    expect(Object.keys(kit.bundledModules)).toContain('@localixai/dataview')
    expect(kit.bundledModules['@localixai/mini-app-sdk/backend']).toBeUndefined()
    expect(kit.typePaths['@localixai/dataview']).toBeTruthy()
    expect(readFileSync(join(kitDir, kit.authoring.ambientTypes), 'utf8')).toContain("'*.css'")
  })

  // The host hands every backend the same SDK modules at runtime; a first-party mini app used the
  // ones a third party's build refused (navigation, resource refs), so it could not ship the way
  // any other mini app does.
  test('its backend may import every SDK module the host serves a backend', () => {
    const kit = readJson(join(kitDir, 'kit.json'))
    for (const specifier of [
      '@localixai/mini-app-sdk/navigation',
      '@localixai/mini-app-sdk/resource-refs',
      '@localixai/mini-app-sdk/typed-error',
    ]) {
      expect(kit.authoring.backendSharedModules).toContain(specifier)
      expect(kit.typePaths[specifier]).toBeTruthy()
    }
  })
})
