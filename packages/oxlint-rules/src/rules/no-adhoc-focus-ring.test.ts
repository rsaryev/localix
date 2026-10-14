import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { CONTRACT_OWNERS, noAdhocFocusRing } from './no-adhoc-focus-ring.ts'
import { runRule } from '../testing/run-rule.ts'

const RULE = 'no-adhoc-focus-ring'
const IN_FEATURE = 'apps/ui/src/features/demo/'
const REPO_ROOT = resolve(import.meta.dir, '../../../..')

describe(RULE, () => {
  test('reports a hand-rolled focus-visible ring', async () => {
    const findings = await runRule(
      RULE,
      `export function Row() {
         return <button className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
       }`,
      { filename: `${IN_FEATURE}Row.tsx` },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('focus-ring')
  })

  test('reports a `focus:` ring, which also lights up on mouse clicks', async () => {
    const findings = await runRule(
      RULE,
      `export function Field() {
         return <input className="focus:ring-2 focus:ring-ring/20" />
       }`,
      { filename: `${IN_FEATURE}Field.tsx` },
    )
    expect(findings).toHaveLength(1)
  })

  test('reports a status colour used as a focus ring', async () => {
    const findings = await runRule(
      RULE,
      `export function Card() {
         return <div className="focus-visible:ring-2 focus-visible:ring-status-info/45" />
       }`,
      { filename: 'apps/ui/src/features/example/ui/cards.tsx' },
    )
    expect(findings).toHaveLength(1)
  })

  test('allows the canonical utility', async () => {
    const findings = await runRule(
      RULE,
      `export function Row() {
         return <button className="rounded-md outline-none focus-ring" />
       }`,
      { filename: `${IN_FEATURE}Row.tsx` },
    )
    expect(findings).toEqual([])
  })

  test('allows a resting ring, which is a border rather than a focus indicator', async () => {
    const findings = await runRule(
      RULE,
      `export function Panel() {
         return <div className="rounded-xl ring-1 ring-foreground/10" />
       }`,
      { filename: `${IN_FEATURE}Panel.tsx` },
    )
    expect(findings).toEqual([])
  })

  test('allows the primitives that DEFINE the contract', async () => {
    const findings = await runRule(
      RULE,
      `export function Group() {
         return <div className="has-[:focus-visible]:ring-1 focus-within:ring-control-border-focus" />
       }`,
      { filename: 'packages/kit/src/controls/input-group.tsx' },
    )
    expect(findings).toEqual([])
  })

  // The narrowed list is the point: a primitive that gets focus by interpolating
  // `CONTROL_FOCUS_VISIBLE` has no licence to hand-spell a second one, and until this case existed
  // the exemption covered half the kit.
  test('reports a primitive that transcribes the recipe instead of importing it', async () => {
    const findings = await runRule(
      RULE,
      `export function Input() {
         return <input className="focus-visible:ring-2 focus-visible:ring-ring/30" />
       }`,
      { filename: 'packages/kit/src/controls/input.tsx' },
    )
    expect(findings).toHaveLength(1)
  })

  // A path fragment in an exemption list cannot be verified by reading the list, which is how
  // `shared/ui/toggle.tsx` outlived the file and `shared/ui/segmented-control` outlived the move to
  // the SDK. This is the assertion that makes the next such deletion loud.
  test('every contract owner is a file that exists', () => {
    const missing = CONTRACT_OWNERS.filter((owner) => !existsSync(join(REPO_ROOT, owner)))
    expect(missing).toEqual([])
  })

  test('the existence check would fail on a stale owner path', () => {
    expect(existsSync(join(REPO_ROOT, 'apps/ui/src/shared/ui/toggle.tsx'))).toBe(false)
  })

  // The owners are matched by `includes` against an ABSOLUTE filename, so a repo-relative path has
  // to be a suffix of one. A leading slash or a `./` prefix in the list would silently exempt
  // nothing.
  test('an owner path matches an absolute filename', () => {
    for (const owner of CONTRACT_OWNERS) {
      expect(join(REPO_ROOT, owner).includes(owner)).toBe(true)
    }
    expect(typeof noAdhocFocusRing.create).toBe('function')
  })
})
