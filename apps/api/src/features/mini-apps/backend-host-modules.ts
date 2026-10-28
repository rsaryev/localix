import { plugin } from 'bun'
import * as hono from 'hono'
import * as zod from 'zod'
import * as sdkBackend from '@localixai/mini-app-sdk/backend'
import * as sdkNavigation from '@localixai/mini-app-sdk/navigation'
import * as sdkResourceRefs from '@localixai/mini-app-sdk/resource-refs'
import * as sdkSessionResource from '@localixai/mini-app-sdk/session-resource'
import * as sdkTypedError from '@localixai/mini-app-sdk/typed-error'
import * as sdkPrerequisite from '@localixai/mini-app-sdk/prerequisite'
import * as sdkRichText from '@localixai/mini-app-sdk/rich-text'
import * as storeChanges from '@localixai/mini-app-sdk/store-changes'
import * as sdkDocumentLayout from '@localixai/mini-app-sdk/document-layout'

import type { MiniAppBackendHostModule } from './kit-layout'

/**
 * The host's own instance of each module a mini app backend imports as external
 * (`MINI_APP_BACKEND_HOST_MODULES`), served to those imports by a Bun runtime mini app.
 *
 * Why a runtime mini app and not a file path: resolving the bare import to the host's FILE loads a
 * second instance of it, which is exactly the duplicate this removes (measured: no RSS saved, and
 * 950 ms of re-evaluation). `module()` answers the specifier with the namespace the host has
 * already evaluated, so a mini app's `z` and `Hono` are the host's objects. Keyed by the list's
 * type, so a specifier added there without an instance here does not compile.
 */
const HOST_MODULES: Record<MiniAppBackendHostModule, Record<string, unknown>> = {
  hono,
  zod,
  '@localixai/mini-app-sdk/backend': sdkBackend,
  '@localixai/mini-app-sdk/navigation': sdkNavigation,
  '@localixai/mini-app-sdk/resource-refs': sdkResourceRefs,
  '@localixai/mini-app-sdk/session-resource': sdkSessionResource,
  '@localixai/mini-app-sdk/typed-error': sdkTypedError,
  '@localixai/mini-app-sdk/prerequisite': sdkPrerequisite,
  '@localixai/mini-app-sdk/rich-text': sdkRichText,
  '@localixai/mini-app-sdk/store-changes': storeChanges,
  '@localixai/mini-app-sdk/document-layout': sdkDocumentLayout,
}

let installed = false

/**
 * Serve the host modules to every later import in this process. Idempotent; call before any
 * mini app backend is imported (the infra phase does, first thing).
 */
export function installBackendHostModules(): void {
  if (installed) return
  installed = true
  plugin({
    name: 'localix-mini-app-backend-host-modules',
    setup(build) {
      for (const [specifier, exports] of Object.entries(HOST_MODULES)) {
        build.module(specifier, () => ({ exports, loader: 'object' }))
      }
    },
  })
}

/** The instance the host serves for a specifier (tests compare identities through it). */
export function hostModule(specifier: MiniAppBackendHostModule): Record<string, unknown> {
  return HOST_MODULES[specifier]
}
