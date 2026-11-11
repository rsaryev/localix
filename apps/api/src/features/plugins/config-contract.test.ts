import { describe, expect, test } from 'bun:test'

import { scalarConfig } from '../capabilities/source-repository'
import { setPluginConfigRequestSchema } from './contracts'
import { resolvePluginConfig, type PluginConfigValues } from './config'
import type { LocalixManifest } from './contracts'

/**
 * `PluginConfigValues = Record<string, string | number | boolean>` — IS THE TYPE HONEST?
 *
 * It was filed as a suspected LIE: the theory was that `resolvePluginConfig` copies the
 * `plugins` table's unvalidated parsed-JSON `config` column verbatim, so a stored `null`
 * really reaches the plugin's resolved values, which the type says is impossible — a type gap
 * at an unchecked boundary.
 *
 * IT IS NOT A LIE. `resolvePluginConfig` has exactly TWO inputs, and BOTH are filtered
 * before it ever sees them. There are three independent barriers, and this file is the
 * one place that checks all three TOGETHER — because that is the claim, and no single
 * test of any one barrier can establish it:
 *
 *   1. WRITE   `setPluginConfigRequestSchema.values` is a Zod record of
 *              `string | number | boolean`. A `null` is REJECTED at the route; it never
 *              reaches the column.
 *   2. READ    every reader passes the stored config through `scalarConfig`
 *              (`capabilities/source-repository.ts`), which keeps ONLY primitives. A
 *              `null`, array, or object in the column is DROPPED before it is resolved.
 *   3. DEFAULT a setting's default is `string | number | boolean` (`PluginConfigOption`): the
 *              kit refuses any other `userConfig` default, and a list's is kept as its JSON.
 *
 * The invariant is CHECKED here instead of being folklore.
 *
 * Barriers 1 and 2 are falsifiable below: widen either and this file goes red. Barrier 3 is held
 * by the type checker (`settingOf` in `kit/catalog/manifest.ts` returns `PluginConfigOption`).
 */

/** A stored `config` column as every reader sees it: parsed, then `scalarConfig`. */
const readStored = (raw: string) => scalarConfig(JSON.parse(raw) as Record<string, unknown>)

const mkManifest = (config: LocalixManifest['config']): LocalixManifest => ({ name: 'p', config })

describe('PluginConfigValues is honest — every path in filters non-primitives', () => {
  test('BARRIER 1 (write): the route schema REJECTS a null / array / object value', () => {
    const ok = setPluginConfigRequestSchema.safeParse({
      name: 'p',
      values: { A: 'x', B: 2, C: true },
    })
    expect(ok.success).toBe(true)

    for (const bad of [null, ['a'], { k: 1 }]) {
      const r = setPluginConfigRequestSchema.safeParse({ name: 'p', values: { A: bad } })
      expect(r.success, `values.A = ${JSON.stringify(bad)} must be rejected at the route`).toBe(
        false,
      )
    }
  })

  test('BARRIER 2 (read): scalarConfig DROPS a stored null / array / object', () => {
    // Every reader passes the stored config through this before resolvePluginConfig.
    expect(readStored('{"a":"x","nil":null,"list":[1,2],"nested":{"k":1}}')).toStrictEqual({
      a: 'x',
    })
  })

  test('END-TO-END: resolvePluginConfig only ever emits primitives, so the type holds', () => {
    // Feed it the WORST case each barrier permits: a manifest default plus stored values
    // that already came through scalarConfig.
    const manifest = mkManifest({
      WITH_DEFAULT: {
        type: 'string',
        title: 'T',
        description: '',
        required: false,
        secret: false,
        default: 'd',
      },
      OVERRIDDEN: {
        type: 'number',
        title: 'T',
        description: '',
        required: false,
        secret: false,
        default: 1,
      },
      NO_DEFAULT: { type: 'string', title: 'T', description: '', required: false, secret: false },
    })
    const stored = readStored('{"OVERRIDDEN":9,"NIL":null,"LIST":[1]}')
    const resolved: PluginConfigValues = resolvePluginConfig(manifest, stored)

    // The default applies; the stored value WINS over it; NO_DEFAULT stays absent; and the
    // null/array the column carried are simply not there.
    expect(resolved).toStrictEqual({ WITH_DEFAULT: 'd', OVERRIDDEN: 9 })
    for (const v of Object.values(resolved)) {
      expect(['string', 'number', 'boolean']).toContain(typeof v)
    }
  })
})

/**
 * `multiple: true` — WHAT DOES IT ACTUALLY DO?
 *
 * Filed as "the schema accepts `multiple: true` and the UI surfaces a multi-select, but no
 * storage path carries a multi-value, so the user picks several options and NOTHING is
 * stored". That report is REFUTED on its own terms, and this block is why:
 *
 *   - There is no multi-select. `SettingsConfigForm.tsx` is the SOLE renderer of plugin
 *     config fields (`PluginsSettings.tsx` → `<SettingsConfigForm fields={plugin.config}/>`),
 *     and its `ConfigFormField` interface does not even declare `multiple` — it renders a
 *     plain text `<input>`. Nothing anywhere reads `PluginConfigField.multiple`.
 *   - So nothing is silently dropped: there is nothing to pick, and the text a user types is
 *     stored verbatim as the `string` the type promises.
 *
 * The DECLARED contract (docs/extending/claude-code-plugins.md, `multiple` row) is that the value is a
 * COMMA-SEPARATED STRING which the plugin's own native tool parses. A comma-separated list
 * IS a string, so `PluginConfigValues = Record<string, string|number|boolean>` carries it
 * exactly. `multiple` is a manifest-level hint to the plugin author, not a storage mode.
 *
 * Two things are therefore pinned here, because the next reader will re-file this otherwise:
 *   1. `multiple: true` must keep being ACCEPTED. Rejecting it (the tempting "make the schema
 *      honest" fix) would fail the load of any Claude Code plugin that declares it — turning
 *      an inert hint into an outage. CC parity is the whole reason the field exists.
 *   2. Declaring it must change NOTHING about storage: the value still round-trips as a
 *      primitive, and a real multi-value (an array) is still refused at the write barrier and
 *      dropped at the read barrier — exactly as for any other field.
 */
describe('`multiple: true` is a manifest HINT, not a storage mode', () => {
  test('a multiple:true field stores its comma-separated list as an ordinary string', () => {
    // This is the documented contract: the native tool owns the parsing.
    const write = setPluginConfigRequestSchema.safeParse({ name: 'p', values: { TAGS: 'a,b,c' } })
    expect(write.success).toBe(true)

    const manifest = mkManifest({
      TAGS: {
        type: 'string',
        title: 'T',
        description: '',
        required: false,
        secret: false,
        multiple: true,
      },
    })
    const resolved = resolvePluginConfig(manifest, readStored('{"TAGS":"a,b,c"}'))
    expect(resolved).toStrictEqual({ TAGS: 'a,b,c' })
  })

  test('multiple:true does NOT unlock array storage — both barriers still refuse one', () => {
    // The hint is inert at the storage boundary: an actual array is rejected on write and
    // dropped on read whether or not the field declared `multiple`. If a future change makes
    // arrays storable, THIS is the test that must be updated deliberately.
    expect(
      setPluginConfigRequestSchema.safeParse({ name: 'p', values: { TAGS: ['a', 'b'] } }).success,
    ).toBe(false)
    expect(readStored('{"TAGS":["a","b"]}')).toStrictEqual({})
  })
})
