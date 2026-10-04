import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'

import { defaultErrorHandler } from '../../lib/http'
import type { AppContext } from '../../app'
import {
  type AddProviderKeyRequest,
  type CompleteOAuthRequest,
  type ConnectFromEnvRequest,
  type CreateProviderConnectionRequest,
  type EnvDetectedProvider,
  type InitiateOAuthRequest,
  type ProviderConnection,
  type ProviderConnectionKey,
  type UpdateProviderConnectionRequest,
  type UpdateProviderKeyRequest,
  addProviderKeyRequestSchema,
  completeOAuthRequestSchema,
  connectFromEnvRequestSchema,
  createProviderConnectionRequestSchema,
  initiateOAuthRequestSchema,
  initiateOAuthResponseSchema,
  listEnvDetectedProvidersResponseSchema,
  listProviderConnectionsResponseSchema,
  listProviderKeysResponseSchema,
  providerConnectionSchema,
  updateProviderConnectionParamsSchema,
  updateProviderConnectionRequestSchema,
  updateProviderKeyParamsSchema,
  updateProviderKeyRequestSchema,
} from './contracts'

export interface ProviderConnectionsRoutesService {
  listConnections(userId: string): Promise<{ connections: ProviderConnection[] }>
  createConnection(
    userId: string,
    input: CreateProviderConnectionRequest,
  ): Promise<ProviderConnection>
  listEnvDetectedProviders(userId: string): Promise<{ providers: EnvDetectedProvider[] }>
  connectFromEnv(userId: string, input: ConnectFromEnvRequest): Promise<ProviderConnection>
  updateConnection(
    userId: string,
    id: string,
    patch: UpdateProviderConnectionRequest,
  ): Promise<ProviderConnection>
  deleteConnection(userId: string, id: string): Promise<void>
  listKeys(userId: string, id: string): Promise<{ keys: ProviderConnectionKey[] }>
  addKey(userId: string, id: string, input: AddProviderKeyRequest): Promise<ProviderConnection>
  updateKey(
    userId: string,
    id: string,
    keyId: string,
    patch: UpdateProviderKeyRequest,
  ): Promise<ProviderConnection>
  removeKey(userId: string, id: string, keyId: string): Promise<ProviderConnection>
  initiateOAuth(
    userId: string,
    input: InitiateOAuthRequest,
  ): Promise<{
    state: string
    mode: 'app-redirect' | 'local-server' | 'device-code'
    redirectUrl?: string
    userCode?: string
    verificationUri?: string
    expiresInSeconds?: number
    intervalSeconds?: number
  }>
  completeOAuth(userId: string, input: CompleteOAuthRequest): Promise<ProviderConnection>
}

export function createProviderConnectionsRoutes(service: ProviderConnectionsRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/', async (c) => {
      const response = await service.listConnections(c.get('userId'))
      return c.json(listProviderConnectionsResponseSchema.parse(response), 200)
    })
    .post('/oauth/initiate', zValidator('json', initiateOAuthRequestSchema), async (c) => {
      const body = c.req.valid('json')
      const response = await service.initiateOAuth(c.get('userId'), body)
      return c.json(initiateOAuthResponseSchema.parse(response), 200)
    })
    .post('/oauth/callback', zValidator('json', completeOAuthRequestSchema), async (c) => {
      const body = c.req.valid('json')
      const response = await service.completeOAuth(c.get('userId'), body)
      return c.json(providerConnectionSchema.parse(response), 201)
    })
    .post('/', zValidator('json', createProviderConnectionRequestSchema), async (c) => {
      const body = c.req.valid('json')
      const response = await service.createConnection(c.get('userId'), body)
      return c.json(providerConnectionSchema.parse(response), 201)
    })
    // Onboarding env-key auto-detect. Static paths, declared before the `/:id`
    // routes so they never get swallowed by a param match.
    .get('/env-detected', async (c) => {
      const response = await service.listEnvDetectedProviders(c.get('userId'))
      return c.json(listEnvDetectedProvidersResponseSchema.parse(response), 200)
    })
    .post('/env-detected/connect', zValidator('json', connectFromEnvRequestSchema), async (c) => {
      const response = await service.connectFromEnv(c.get('userId'), c.req.valid('json'))
      return c.json(providerConnectionSchema.parse(response), 201)
    })
    .patch(
      '/:id',
      zValidator('param', updateProviderConnectionParamsSchema),
      zValidator('json', updateProviderConnectionRequestSchema),
      async (c) => {
        const { id } = c.req.valid('param')
        const body = c.req.valid('json')
        const response = await service.updateConnection(c.get('userId'), id, body)
        return c.json(providerConnectionSchema.parse(response), 200)
      },
    )
    .delete('/:id', zValidator('param', updateProviderConnectionParamsSchema), async (c) => {
      const { id } = c.req.valid('param')
      await service.deleteConnection(c.get('userId'), id)
      return c.body(null, 204)
    })
    .get('/:id/keys', zValidator('param', updateProviderConnectionParamsSchema), async (c) => {
      const { id } = c.req.valid('param')
      const response = await service.listKeys(c.get('userId'), id)
      return c.json(listProviderKeysResponseSchema.parse(response), 200)
    })
    .post(
      '/:id/keys',
      zValidator('param', updateProviderConnectionParamsSchema),
      zValidator('json', addProviderKeyRequestSchema),
      async (c) => {
        const { id } = c.req.valid('param')
        const response = await service.addKey(c.get('userId'), id, c.req.valid('json'))
        return c.json(providerConnectionSchema.parse(response), 201)
      },
    )
    .patch(
      '/:id/keys/:keyId',
      zValidator('param', updateProviderKeyParamsSchema),
      zValidator('json', updateProviderKeyRequestSchema),
      async (c) => {
        const { id, keyId } = c.req.valid('param')
        const response = await service.updateKey(c.get('userId'), id, keyId, c.req.valid('json'))
        return c.json(providerConnectionSchema.parse(response), 200)
      },
    )
    .delete('/:id/keys/:keyId', zValidator('param', updateProviderKeyParamsSchema), async (c) => {
      const { id, keyId } = c.req.valid('param')
      const response = await service.removeKey(c.get('userId'), id, keyId)
      return c.json(providerConnectionSchema.parse(response), 200)
    })

  routes.onError(defaultErrorHandler)

  return routes
}
