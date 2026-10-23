import { describe, expect, test } from 'bun:test'

import { revealSealed, sealedSchema, sealedView, verifySealed } from '../sealed'
import { seal } from './sealed'

const AT = '2026-10-18T10:00:00.000Z'

describe('seal', () => {
  test('commits unrevealed, with a fresh salt each time', () => {
    const a = seal('rock', 'agent', AT)
    const b = seal('rock', 'agent', AT)
    expect(sealedSchema.parse(a)).toEqual(a)
    expect(a.revealedAt).toBeNull()
    expect(a.salt).not.toBe(b.salt)
    expect(a.digest).not.toBe(b.digest)
  })

  test('the view holds only the digest until revealed', () => {
    const sealed = seal('rock', 'agent', AT)
    const view = sealedView(sealed)
    expect(view).toEqual({ revealed: false, owner: 'agent', digest: sealed.digest })
    expect(JSON.stringify(view)).not.toContain('rock')
    expect(JSON.stringify(view)).not.toContain(sealed.salt)
  })

  test('a revealed view verifies against the committed digest', async () => {
    const sealed = seal('paper', 'agent', AT)
    const revealed = revealSealed(sealed, AT)
    expect(revealSealed(revealed, 'later')).toBe(revealed)
    const view = sealedView(revealed)
    expect(view).toMatchObject({ revealed: true, value: 'paper', salt: sealed.salt })
    expect(await verifySealed(view)).toBe(true)
  })

  test('verification refuses a swapped value and an unrevealed view', async () => {
    const sealed = seal('paper', 'agent', AT)
    const view = sealedView(revealSealed(sealed, AT))
    if (!view.revealed) throw new Error('expected a revealed view')
    expect(await verifySealed({ ...view, value: 'rock' })).toBe(false)
    expect(await verifySealed(sealedView(sealed))).toBe(false)
  })
})
