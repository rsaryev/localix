import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('warm-hidden DevOps work items', () => {
  /**
   * The whole browser-reachable chain, not just its first two links.
   *
   * This guard used to name `resourceLink.ts` and `resource-nodes.ts` only, and the regression
   * walked straight past it: `resource-nodes.ts` later grew `import { mapKubeError } from
   * './errors'`, and THAT file imported the `./backend` barrel — which re-exports `net-safety`,
   * which reaches for `node:dns`. Vite externalizes `node:dns` to a stub that throws on first
   * property access, so importing the DevOps UI entrypoint threw, `bundledMiniAppUi` caught it
   * per-mini-app, and the only visible symptom was a DevOps workspace missing from the rail and
   * the Capabilities panel while the mini app itself still listed as enabled.
   *
   * So the assertion follows the EDGE, not a fixed pair of files: everything the UI can reach
   * transitively is held to the browser-safe entrypoints. `check-architecture.mjs` cannot catch
   * this on its own — it flags `mini-app-sdk/backend` per file, and `errors.ts` lives under
   * `backend/`, where that import is entirely legal in isolation.
   */
  test('every browser-reachable module avoids the Node-only SDK barrel', () => {
    const chain = {
      'kubernetes/ui/model/resourceLink.ts': read('../kubernetes/ui/model/resourceLink.ts'),
      'kubernetes/backend/resource-nodes.ts': read('../kubernetes/backend/resource-nodes.ts'),
      'kubernetes/backend/errors.ts': read('../kubernetes/backend/errors.ts'),
      'kubernetes/backend/contracts.ts': read('../kubernetes/backend/contracts.ts'),
      'docker/backend/errors.ts': read('../docker/backend/errors.ts'),
      'docker/backend/contracts.ts': read('../docker/backend/contracts.ts'),
      'docker/backend/bytes.ts': read('../docker/backend/bytes.ts'),
    }

    for (const [name, source] of Object.entries(chain)) {
      expect(source, `${name} is reachable from mini app UI`).not.toContain(
        "from '@localixai/mini-app-sdk/backend'",
      )
    }

    expect(chain['kubernetes/ui/model/resourceLink.ts']).toContain(
      '@localixai/mini-app-sdk/resource-refs',
    )
    expect(chain['kubernetes/backend/resource-nodes.ts']).toContain(
      '@localixai/mini-app-sdk/resource-refs',
    )
    expect(chain['kubernetes/backend/errors.ts']).toContain('@localixai/mini-app-sdk/typed-error')
    expect(chain['docker/backend/errors.ts']).toContain('@localixai/mini-app-sdk/typed-error')
  })
})
