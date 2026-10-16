import { describe, expect, test } from 'bun:test'
import type { SkillRecord, SkillInput } from '@/shared/api/contracts'
import type {
  SkillRecord as OwnedSkillRecord,
  SkillInput as OwnedSkillInput,
} from '@localixai/api/client'

/**
 * A COMPILE-TIME guard, not a runtime one. `tsconfig.app.json` includes all of `src`
 * with no test exclusion, so `bun run type-check` type-checks this file — which makes
 * these assertions a real gate rather than documentation.
 *
 * The bug they pin: the settings UI hand-restated `SkillRecord`/`SkillInput`. The copy
 * drifted so that the UI could READ `argumentHint`/`userInvocable` off a skill while
 * `SkillInput` could express neither — and the skills write path replaced SKILL.md
 * wholesale, so saving an edit deleted every frontmatter key the short type could not
 * name. That is the exact shape that wiped MCP OAuth credentials.
 *
 * `Exact` compares KEY SETS before types, and that is load-bearing: every field the
 * old copy dropped (`allowedTools`, `hooks`, `argumentNames`, …) is OPTIONAL, and a
 * type that simply omits an optional property is still mutually assignable with the
 * full one. Plain `A extends B && B extends A` therefore sees no drift at all — the
 * blindness is precisely where this bug class breeds. Comparing `keyof` catches it.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false

type Exact<A, B> =
  SameKeys<A, B> extends true ? ([A] extends [B] ? ([B] extends [A] ? true : false) : false) : false

const skillRecordIsOwnedByTheApi: Exact<SkillRecord, OwnedSkillRecord> = true
const skillInputIsOwnedByTheApi: Exact<SkillInput, OwnedSkillInput> = true

/**
 * The lethal intersection is `wholesale-replace write` ∩ `restated consumer type`:
 * a reader that knows a field its own writer type cannot express. Assert the UI's
 * write payload is the API's, so the two can never again be declared apart.
 */
describe('skills contracts are re-exported, never restated', () => {
  test('the UI reads and writes the API-owned skill types', () => {
    expect(skillRecordIsOwnedByTheApi).toBe(true)
    expect(skillInputIsOwnedByTheApi).toBe(true)
  })
})
