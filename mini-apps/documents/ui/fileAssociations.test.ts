import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import type { DedicatedViewerType } from '@localixai/mini-app-sdk/ui/file-types'
import { __resetDocumentsUiRegistration, registerUi } from './register'

/**
 * The two halves of "Localix opens this format" must name the same formats.
 *
 * `registerUi` tells the RUNNING app which extensions get a dedicated viewer;
 * The mini app's `fileAssociations` (`mini-app.json`) tells the operating system, at package time, which
 * extensions to route to Localix at all. They are written in different files, read by
 * different processes, and nothing but this test connects them — which is how the
 * viewers below shipped while Finder had never heard of a single one of them.
 *
 * Drift in either direction is a real defect:
 *   - registered but not declared → the viewer exists and "Open With" never offers it
 *   - declared but not registered → a double-click opens Localix, which shows page bytes
 */

// registerUi is idempotent (module-level `registered` latch), so calling it here is safe
// whether or not another suite in this process already did.
const noop = { register: () => {} }
const registeredFormats: Record<string, DedicatedViewerType> = {}
__resetDocumentsUiRegistration()
registerUi({
  workItems: noop,
  railSections: noop,
  railViewlets: noop,
  search: noop,
  resourceRefIcons: noop,
  fileEditors: noop,
  fileFormats: {
    register: (entries: Record<string, DedicatedViewerType>) =>
      Object.assign(registeredFormats, entries),
  },
  sessionEvents: { register: () => {} },
  statusItems: noop,
} as unknown as MiniAppUiHost)

const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'mini-app.json'), 'utf8')) as {
  fileAssociations?: { ext: string[]; mimeType?: string }[]
}

const declared = (manifest.fileAssociations ?? []).flatMap((entry) => entry.ext)

describe('documents file associations', () => {
  test('every extension declared to the OS has a dedicated viewer in-app', () => {
    for (const ext of declared) {
      expect({ ext, hasViewer: registeredFormats[ext] !== undefined }).toEqual({
        ext,
        hasViewer: true,
      })
    }
  })

  test('the declared MIME type matches what the viewer registry serves, per extension', () => {
    // The manifest's mimeType lands in the Linux `.desktop` file and the macOS
    // UTTypeTagSpecification; the registry's contentType is what the app serves the
    // viewer. A mismatch means the OS and the app disagree about what the bytes are.
    //
    // Tauri writes ONE `MimeType=` per entry, so an entry may only group extensions
    // that genuinely share a type — equality per extension is what enforces that. A
    // grouped `.odt` under the `.docx` type would pass a "contains" check and still be
    // unroutable on Linux.
    for (const entry of manifest.fileAssociations ?? []) {
      if (!entry.mimeType) continue
      for (const ext of entry.ext) {
        expect({ ext, mimeType: registeredFormats[ext]?.contentType }).toEqual({
          ext,
          mimeType: entry.mimeType,
        })
      }
    }
  })

  test('the formats the mini app ships viewers for are all declared', () => {
    // The inverse direction: a viewer nobody told the OS about is invisible outside
    // the app. Listed explicitly so ADDING a viewer fails here until the manifest
    // catches up, rather than silently shipping half-wired.
    for (const ext of ['pdf', 'docx', 'doc', 'odt', 'pptx', 'xlsx', 'xls', 'xlsm', 'xlsb', 'csv']) {
      expect({ ext, declared: declared.includes(ext) }).toEqual({ ext, declared: true })
    }
  })
})
