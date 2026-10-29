import { describe, expect, test } from 'bun:test'

import { BINARY_IMAGE_MIME } from '../../api/src/features/chat/service/files'
import {
  CORE_FILE_ASSOCIATIONS,
  buildFileAssociations,
  checkFileAssociations,
  normalizeExt,
  readTauriConfig,
} from './file-associations.mjs'

/**
 * The gate behind `file-associations.mjs`: what the OS is told Localix can open must
 * equal what core actually claims.
 *
 * `bundle.fileAssociations` is read once, at package time, by a Rust bundler nothing here
 * can run; the runtime viewers are read by the SPA. Nothing links them except this check.
 */
describe('OS file associations', () => {
  test('the committed tauri.conf.json matches the core list', () => {
    const { ok, expected, actual } = checkFileAssociations()
    // Compare the values, not the boolean, so a failure PRINTS the drift instead of
    // reporting `false !== true` and sending the reader to a 130-line JSON file.
    expect(actual).toEqual(expected)
    expect(ok).toBe(true)
  })

  test('no extension is claimed by two owners', () => {
    // buildFileAssociations throws on a conflict; assert the invariant it guarantees
    // holds for the real tree, so a duplicate surfaces here and not at package time.
    const all = buildFileAssociations().flatMap((entry) => entry.ext)
    expect(new Set(all).size).toBe(all.length)
  })

  test('every extension reaches the installers dot-less and lower-cased', () => {
    for (const entry of buildFileAssociations()) {
      for (const ext of entry.ext) {
        expect(ext).toBe(normalizeExt(ext))
        expect(ext).toMatch(/^[a-z0-9][a-z0-9+._-]*$/)
      }
    }
  })

  test('every entry names the kind the OS file manager shows', () => {
    // Tauri would fall back to `ext[0]`, so a missing name is not an error — it is a
    // Finder row reading "db". Requiring it keeps the bundle's labels deliberate.
    for (const entry of buildFileAssociations()) {
      expect(entry.name.trim().length).toBeGreaterThan(0)
    }
  })

  test('core keeps the text/source families', () => {
    const core = CORE_FILE_ASSOCIATIONS.flatMap((entry) => entry.ext)
    expect(core).toContain('ts')
    expect(core).toContain('md')
  })

  test("core's image claims match the formats the core viewer actually decodes", () => {
    // `BINARY_IMAGE_MIME` is what the server serves as `image/*`, and it is the exact
    // condition under which FileTab renders its image pane instead of the code editor.
    // Claiming a format core cannot decode means an Open With that shows "preview not
    // supported"; omitting one means a viewer the OS never offers.
    const served = new Map(
      Object.entries(BINARY_IMAGE_MIME).map(([dotExt, mime]) => [dotExt.slice(1), mime]),
    )
    const claimed = new Map(
      CORE_FILE_ASSOCIATIONS.filter((entry) => entry.mimeType?.startsWith('image/')).flatMap(
        (entry) => entry.ext.map((ext) => [ext, entry.mimeType]),
      ),
    )
    expect(claimed).toEqual(served)
  })

  test('one MIME type per entry — the Linux .desktop file advertises no more', () => {
    // Tauri joins the associations' mimeType values into a single `MimeType=` list, one
    // per entry. Grouping extensions that do NOT share a type therefore drops all but
    // the first on Linux while still matching on macOS, which routes by extension.
    // `text/plain` is the one honest group: every extension in it really is plain text.
    for (const entry of buildFileAssociations()) {
      if (entry.ext.length === 1 || entry.mimeType === undefined) continue
      const shared = entry.mimeType === 'text/plain' || entry.mimeType === 'image/jpeg' // jpg + jpeg
      expect({ name: entry.name, groupsOneType: shared }).toEqual({
        name: entry.name,
        groupsOneType: true,
      })
    }
  })

  test('roles and ranks stay inside what the Tauri bundler accepts', () => {
    // Tauri deserializes these into BundleTypeRole / HandlerRank enums whose variants
    // serialize verbatim; an unknown spelling fails the bundle, not this repo's types.
    for (const entry of buildFileAssociations()) {
      if (entry.role !== undefined) {
        expect(['Editor', 'Viewer', 'Shell', 'None']).toContain(entry.role)
      }
      if (entry.rank !== undefined) {
        expect(['Owner', 'Default', 'Alternate', 'None']).toContain(entry.rank)
      }
    }
  })

  test('the deep-link scheme the file-open flow rides on is still registered', () => {
    // A double-clicked file becomes `localix://open?path=…` (see deeplink.rs) — the
    // association is inert without the scheme, and they are configured apart.
    expect(readTauriConfig().plugins?.['deep-link']?.desktop?.schemes).toContain('localix')
  })
})
