import { z } from 'zod'

/**
 * A SEALED VALUE: something one player commits to — a move, a word, a number — that nobody else may
 * read until the mini app reveals it, and that its owner cannot change after committing.
 *
 * The owning backend keeps the whole {@link Sealed} record and hands every other audience only
 * {@link sealedView}: before the reveal that is the digest alone, after it the value and the salt
 * that let anyone recompute the digest ({@link verifySealed}). Hiding is the mini app's job — the
 * server never sends the value early; the digest only proves afterwards that nothing was swapped.
 *
 * This module is isomorphic (WebCrypto only), so a view can verify what the backend revealed. The
 * backend creates records with `seal` from `@localixai/mini-app-sdk/backend`.
 */

/** Hex SHA-256 of `${salt}:${value}`. */
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)

/** The whole commitment, as the owning backend stores it. Never send it to another audience. */
export const sealedSchema = z.object({
  /** Who committed: a player, a seat, an agent id — the mini app decides. */
  owner: z.string().min(1),
  value: z.string(),
  salt: z.string().min(1),
  digest: digestSchema,
  sealedAt: z.string(),
  revealedAt: z.string().nullable(),
})
export type Sealed = z.infer<typeof sealedSchema>

/** What any audience other than the owner may see of a commitment. */
export const sealedViewSchema = z.discriminatedUnion('revealed', [
  z.object({ revealed: z.literal(false), owner: z.string(), digest: digestSchema }),
  z.object({
    revealed: z.literal(true),
    owner: z.string(),
    digest: digestSchema,
    value: z.string(),
    salt: z.string(),
  }),
])
export type SealedView = z.infer<typeof sealedViewSchema>

/** The audience-safe projection: the digest until revealed, then the value and salt too. */
export function sealedView(sealed: Sealed): SealedView {
  const { owner, digest } = sealed
  return sealed.revealedAt === null
    ? { revealed: false, owner, digest }
    : { revealed: true, owner, digest, value: sealed.value, salt: sealed.salt }
}

/** The same record, revealed at `at`; a revealed record stays as it was. */
export function revealSealed(sealed: Sealed, at: string): Sealed {
  return sealed.revealedAt === null ? { ...sealed, revealedAt: at } : sealed
}

/** The text every digest is computed over. */
export function sealedPreimage(value: string, salt: string): string {
  return `${salt}:${value}`
}

/**
 * Whether a revealed view's value and salt reproduce the digest committed before the reveal.
 * False for a view that is not revealed yet — there is nothing to check.
 */
export async function verifySealed(view: SealedView): Promise<boolean> {
  if (!view.revealed) return false
  const bytes = new TextEncoder().encode(sealedPreimage(view.value, view.salt))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return hex === view.digest
}
