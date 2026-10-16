import { z } from 'zod'

export const providerConnectionAuthTypeSchema = z.enum(['api-key', 'oauth-pkce'])

export const providerConnectionKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Masked preview, e.g. "…4f2a". Raw key never leaves the server. */
  maskedKey: z.string(),
  priority: z.number(),
  enabled: z.boolean(),
})

export const providerConnectionSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  label: z.string(),
  authType: providerConnectionAuthTypeSchema,
  hasApiKey: z.boolean(),
  keyCount: z.number(),
  keys: z.array(providerConnectionKeySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listProviderConnectionsResponseSchema = z.object({
  connections: z.array(providerConnectionSchema),
})

export const createProviderConnectionRequestSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  label: z.string().min(1),
  authType: providerConnectionAuthTypeSchema,
  apiKey: z.string().min(1).optional(),
  /** Additional keys to seed the pool with (beyond `apiKey`). */
  apiKeys: z.array(z.string().min(1)).optional(),
})

export const addProviderKeyRequestSchema = z.object({
  apiKey: z.string().min(1),
  label: z.string().optional(),
})

export const updateProviderKeyParamsSchema = z.object({
  id: z.string().min(1),
  keyId: z.string().min(1),
})

export const updateProviderKeyRequestSchema = z.object({
  label: z.string().optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
})

export const listProviderKeysResponseSchema = z.object({
  keys: z.array(providerConnectionKeySchema),
})

/** Live-discovered model ids for a connection (provider drop-in `listModels`). */
export const updateProviderConnectionParamsSchema = z.object({
  id: z.string().min(1),
})

export const updateProviderConnectionRequestSchema = z.object({
  label: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
})

export const initiateOAuthRequestSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  label: z.string().min(1),
  callbackUrl: z.string().url(),
})

export const initiateOAuthResponseSchema = z.object({
  state: z.string(),
  /**
   * 'app-redirect' = provider returns to the SPA; 'local-server' = open a window + poll;
   * 'device-code' = show userCode at verificationUri + poll for the new connection.
   */
  mode: z.enum(['app-redirect', 'local-server', 'device-code']),
  redirectUrl: z.string().optional(),
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  expiresInSeconds: z.number().optional(),
  intervalSeconds: z.number().optional(),
})

export const completeOAuthRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export type ProviderConnection = z.infer<typeof providerConnectionSchema>
export type ProviderConnectionKey = z.infer<typeof providerConnectionKeySchema>
export type CreateProviderConnectionRequest = z.infer<typeof createProviderConnectionRequestSchema>
export type UpdateProviderConnectionRequest = z.infer<typeof updateProviderConnectionRequestSchema>
export type AddProviderKeyRequest = z.infer<typeof addProviderKeyRequestSchema>
export type UpdateProviderKeyRequest = z.infer<typeof updateProviderKeyRequestSchema>
export type InitiateOAuthRequest = z.infer<typeof initiateOAuthRequestSchema>
export type CompleteOAuthRequest = z.infer<typeof completeOAuthRequestSchema>
