import { plugin } from 'bun'
import * as hono from 'hono'
import * as zod from 'zod'
import * as sdkBackend from '@localixai/plugin-sdk/backend'
import * as sdkNavigation from '@localixai/plugin-sdk/navigation'
import * as sdkResourceRefs from '@localixai/plugin-sdk/resource-refs'
import * as sdkSessionResource from '@localixai/plugin-sdk/session-resource'
import * as sdkTypedError from '@localixai/plugin-sdk/typed-error'
import * as sdkPrerequisite from '@localixai/plugin-sdk/prerequisite'
import * as sdkRichText from '@localixai/plugin-sdk/rich-text'
import * as sdkDocumentLayout from '@localixai/plugin-sdk/document-layout'

import type { PluginBackendHostModule } from './authoring/kit-layout'

/**
 * The host's own instance of each module a plugin backend imports as external
 * (`PLUGIN_BACKEND_HOST_MODULES`), served to those imports by a Bun runtime plugin.
 *
 * Why a runtime plugin and not a file path: resolving the bare import to the host's FILE loads a
 * second instance of it, which is exactly the duplicate this removes (measured: no RSS saved, and
 * 950 ms of re-evaluation). `module()` answers the specifier with the namespace the host has
 * already evaluated, so a plugin's `z` and `Hono` are the host's objects. Keyed by the list's type,
 * so a specifier added there without an instance here does not compile.
 */
const HOST_MODULES: Record<PluginBackendHostModule, Record<string, unknown>> = {
  hono,
  zod,
  '@localixai/plugin-sdk/backend': sdkBackend,
  '@localixai/plugin-sdk/navigation': sdkNavigation,
  '@localixai/plugin-sdk/resource-refs': sdkResourceRefs,
  '@localixai/plugin-sdk/session-resource': sdkSessionResource,
  '@localixai/plugin-sdk/typed-error': sdkTypedError,
  '@localixai/plugin-sdk/prerequisite': sdkPrerequisite,
  '@localixai/plugin-sdk/rich-text': sdkRichText,
  '@localixai/plugin-sdk/document-layout': sdkDocumentLayout,
}

let installed = false

/**
 * Serve the host modules to every later import in this process. Idempotent; call before any
 * plugin backend is imported (the infra phase does, first thing).
 */
export function installBackendHostModules(): void {
  if (installed) return
  installed = true
  plugin({
    name: 'localix-plugin-backend-host-modules',
    setup(build) {
      for (const [specifier, exports] of Object.entries(HOST_MODULES)) {
        build.module(specifier, () => ({ exports, loader: 'object' }))
      }
    },
  })
}

/** The instance the host serves for a specifier (tests compare identities through it). */
export function hostModule(specifier: PluginBackendHostModule): Record<string, unknown> {
  return HOST_MODULES[specifier]
}
