import { z } from 'zod'

/** Every byte count, core count and duration in the snapshots: finite and ≥ 0. */
export const nonnegative = z.number().finite().nonnegative()
