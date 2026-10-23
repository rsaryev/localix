/**
 * Account + execution vocabulary — balances, positions, orders, and the create-order
 * request the risk gate validates.
 *
 * DORMANT: the account/execution backend is deliberately NOT registered on the public
 * market-data surface (see `index.ts`). This vocabulary is kept, and kept tested, so the
 * credentialed workbench can be turned back on without re-deriving it — but nothing on
 * the live route surface reads it today.
 */
import { z } from 'zod'

export const orderSideSchema = z.enum(['buy', 'sell'])
export type OrderSide = z.infer<typeof orderSideSchema>
