import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'

import type { AppContext } from '../../app'
import { defaultErrorHandler, jsonError } from '../../lib/http'
import {
  createSecretRequestSchema,
  deleteSecretQuerySchema,
  rotateSecretRequestSchema,
  secretKeyParamsSchema,
  updateSecretMetadataRequestSchema,
  vaultActivityQuerySchema,
} from './contracts'
import type { SecretsService } from './service'

/**
 * Human management surface for the unified Vault. No route returns a decrypted
 * field. Agent/plugin use goes through server-side capabilities instead.
 */
export function createSecretsRoutes(service: SecretsService) {
  const app = new Hono<AppContext>()

  app.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    context.header('Pragma', 'no-cache')
    await next()
  })

  const routes = app
    .get('/', async (context) =>
      context.json({ secrets: await service.list(context.get('userId')) }),
    )
    .get('/activity', zValidator('query', vaultActivityQuerySchema), async (context) =>
      context.json({
        activity: await service.activity(context.get('userId'), context.req.valid('query').limit),
      }),
    )
    .post('/', zValidator('json', createSecretRequestSchema), async (context) => {
      const secret = await service.create(context.get('userId'), context.req.valid('json'))
      return context.json({ secret }, 201)
    })
    .put(
      '/:key',
      zValidator('param', secretKeyParamsSchema),
      zValidator('json', rotateSecretRequestSchema),
      async (context) => {
        const secret = await service.rotate(
          context.get('userId'),
          context.req.valid('param').key,
          context.req.valid('json'),
        )
        return context.json({ secret })
      },
    )
    .patch(
      '/:key',
      zValidator('param', secretKeyParamsSchema),
      zValidator('json', updateSecretMetadataRequestSchema),
      async (context) => {
        const secret = await service.updateMetadata(
          context.get('userId'),
          context.req.valid('param').key,
          context.req.valid('json'),
        )
        return context.json({ secret })
      },
    )
    .get('/:key/versions', zValidator('param', secretKeyParamsSchema), async (context) =>
      context.json({
        versions: await service.versions(context.get('userId'), context.req.valid('param').key),
      }),
    )
    .get('/:key/bindings', zValidator('param', secretKeyParamsSchema), async (context) =>
      context.json({
        bindings: await service.bindings(context.get('userId'), context.req.valid('param').key),
      }),
    )
    .delete(
      '/:key',
      zValidator('param', secretKeyParamsSchema),
      zValidator('query', deleteSecretQuerySchema),
      async (context) => {
        const result = await service.remove(
          context.get('userId'),
          context.req.valid('param').key,
          context.req.valid('query'),
        )
        if (result.status === 'deleted') return context.json({ deleted: true })
        if (result.status === 'missing') {
          return jsonError(context, 404, 'vault_item_not_found', 'Vault item not found')
        }
        if (result.status === 'conflict') {
          return jsonError(
            context,
            409,
            'vault_version_conflict',
            `Vault item changed (current version ${result.currentVersion}). Refresh before deleting.`,
          )
        }
        return context.json(
          {
            error: {
              code: 'vault_item_in_use',
              message: 'Vault item is still used by one or more consumers',
            },
            bindings: result.bindings,
          },
          409,
        )
      },
    )

  routes.onError(defaultErrorHandler)
  return routes
}
