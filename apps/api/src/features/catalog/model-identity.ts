import { z } from 'zod'

/**
 * Durable provider/model identifiers originate in external catalogs, so keep
 * their vocabulary open while bounding every persisted/request-facing copy.
 */
export const MODEL_ID_MAX_CHARS = 512
export const PROVIDER_CONNECTION_ID_MAX_CHARS = 256

export const modelIdSchema = z.string().min(1).max(MODEL_ID_MAX_CHARS)
export const providerConnectionIdSchema = z.string().min(1).max(PROVIDER_CONNECTION_ID_MAX_CHARS)
