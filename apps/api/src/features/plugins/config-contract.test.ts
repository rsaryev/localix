import { describe, expect, test } from 'bun:test'
import { miniAppConfigOptionSchema as sdkPluginConfigOptionSchema } from '@localixai/mini-app-sdk/manifest'

import { scalarConfig } from '../capabilities/source-repository'
import { setPluginConfigRequestSchema } from './contracts'
import { miniAppConfigOptionSchema } from './contracts-config'
import { resolvePluginConfig, type MiniAppConfigValues } from './config'
import { buildPluginOptionEnv } from './mcp'
import type { PluginManifest } from './contracts'

/**
 * `MiniAppConfigValues = Record<string, string | number | boolean>` — IS THE TYPE HONEST?
 *
 * It was filed as a suspected LIE: the theory was that `resolvePluginConfig` copies the
 * `plugins` table's unvalidated parsed-JSON `config` column verbatim, so a stored `null`
 * really reaches `buildPluginOptionEnv`, whose `val !== null` guard would then be LIVE
 * code that the type says is impossible — a type gap at an unchecked boundary.
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
 *   3. DEFAULT `miniAppConfigOptionSchema.default` is `z.union([string, number, boolean])
 *              .optional()`. A manifest cannot declare a null default either.
 *
 * CONSEQUENCE, and the reason this file exists rather than a code change: the `val !==
 * null` guard in `buildPluginOptionEnv` is DEAD code, not live code. The suspicion had it
 * exactly backwards. The guard is harmless belt-and-braces at a JSON boundary and is left
 * alone — but its mere presence is what made the type look like it was lying, so the
 * invariant it implies is now CHECKED here instead of being folklore.
 *
 * Each barrier below is falsifiable: widen any one of the three and this file goes red.
 */

/** A stored `config` column as every reader sees it: parsed, then `scalarConfig`. */
const readStored = (raw: string) => scalarConfig(JSON.parse(raw) as Record<string, unknown>)

const mkManifest = (config: PluginManifest['config']): PluginManifest =>
  ({ name: 'p', config }) as PluginManifest

test('the host re-exports the SDK-owned declarative config schema without overriding it', () => {
  expect(miniAppConfigOptionSchema).toBe(sdkPluginConfigOptionSchema)
})

describe('MiniAppConfigValues is honest — every path in filters non-primitives', () => {
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

  test('BARRIER 3 (manifest): a config option cannot DECLARE a null default', () => {
    expect(miniAppConfigOptionSchema.safeParse({ type: 'string', default: 'x' }).success).toBe(true)
    expect(miniAppConfigOptionSchema.safeParse({ type: 'string', default: null }).success).toBe(
      false,
    )
    expect(miniAppConfigOptionSchema.safeParse({ type: 'string', default: ['a'] }).success).toBe(
      false,
    )
  })

  test('END-TO-END: resolvePluginConfig only ever emits primitives, so the type holds', () => {
    // Feed it the WORST case each barrier permits: a manifest default plus stored values
    // that already came through scalarConfig.
    const manifest = mkManifest({
      WITH_DEFAULT: {
        type: 'string',
        description: '',
        required: false,
        secret: false,
        default: 'd',
      },
      OVERRIDDEN: { type: 'number', description: '', required: false, secret: false, default: 1 },
      NO_DEFAULT: { type: 'string', description: '', required: false, secret: false },
    })
    const stored = readStored('{"OVERRIDDEN":9,"NIL":null,"LIST":[1]}')
    const resolved: MiniAppConfigValues = resolvePluginConfig(manifest, stored)

    // The default applies; the stored value WINS over it; NO_DEFAULT stays absent; and the
    // null/array the column carried are simply not there.
    expect(resolved).toStrictEqual({ WITH_DEFAULT: 'd', OVERRIDDEN: 9 })
    for (const v of Object.values(resolved)) {
      expect(['string', 'number', 'boolean']).toContain(typeof v)
    }
  })

  test('the null-guard in buildPluginOptionEnv is DEAD, and the env map is unaffected by it', () => {
    // Reachable input (what resolvePluginConfig can actually produce) → every key emitted.
    expect(buildPluginOptionEnv({ A: 'x', B: 0, C: false })).toStrictEqual({
      CLAUDE_PLUGIN_OPTION_A: 'x',
      CLAUDE_PLUGIN_OPTION_B: '0',
      CLAUDE_PLUGIN_OPTION_C: 'false',
    })
    // `0` and `false` are FALSY but perfectly valid config values: pin that the guard is a
    // null check and never became a truthiness check, which would silently drop them.
    expect(Object.keys(buildPluginOptionEnv({ B: 0, C: false }))).toHaveLength(2)
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
 * The DECLARED contract (docs/extending/plugins.md, `multiple` row) is that the value is a
 * COMMA-SEPARATED STRING which the plugin's own native tool parses. A comma-separated list
 * IS a string, so `MiniAppConfigValues = Record<string, string|number|boolean>` carries it
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
  test('the schema ACCEPTS multiple:true — rejecting it would break Claude Code plugin loading', () => {
    const opt = miniAppConfigOptionSchema.safeParse({ type: 'string', multiple: true })
    expect(opt.success).toBe(true)
    if (opt.success) expect(opt.data.multiple).toBe(true)
  })

  test('a multiple:true field stores its comma-separated list as an ordinary string', () => {
    // This is the documented contract: the native tool owns the parsing.
    const write = setPluginConfigRequestSchema.safeParse({ name: 'p', values: { TAGS: 'a,b,c' } })
    expect(write.success).toBe(true)

    const manifest = mkManifest({
      TAGS: { type: 'string', description: '', required: false, secret: false, multiple: true },
    })
    const resolved = resolvePluginConfig(manifest, readStored('{"TAGS":"a,b,c"}'))
    expect(resolved).toStrictEqual({ TAGS: 'a,b,c' })
    // …and it reaches the plugin as one string, for the plugin to split itself.
    expect(buildPluginOptionEnv(resolved)).toStrictEqual({ CLAUDE_PLUGIN_OPTION_TAGS: 'a,b,c' })
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
