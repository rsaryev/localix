import type { Hono, Schema } from 'hono'
import { z } from 'zod'
import type { PluginRouteContext, PluginRouteScope } from '@localixai/plugin-sdk/backend'
import type { EnvironmentInfo } from './contracts'
import type { EnvironmentService } from './environments/service'
import type { SavedEnvironment } from './environments/store'
import { environmentVariablesProblem } from './environment-vault'
import { validated, pairSchema } from './route-validation'

interface EnvironmentRoutesDeps {
  uid: (context: { env: PluginRouteScope }) => string
  envs: (context: { env?: Partial<PluginRouteScope> }) => EnvironmentService
}

const ENVIRONMENT_NOT_FOUND = {
  error: 'No environment by that name.',
  code: 'request_not_found' as const,
}

/** Reused by the create/edit/import environment routes. Name is the identity. */
const environmentVariableSchema = pairSchema.extend({ secret: z.boolean().optional() })
const environmentCreateSchema = z.object({
  name: z.string(),
  variables: environmentVariableSchema.array(),
})

const environmentEditSchema = z.object({
  variables: environmentVariableSchema.array(),
})

/** The wire view of a stored environment; secret rows contain references, never resolved values. */
function toEnvInfo(e: SavedEnvironment): EnvironmentInfo {
  return { name: e.id, active: e.active, variables: e.variables }
}

/** Register environment routes on the existing router, preserving its typed request routes. */
export function registerEnvironmentRoutes<TSchema extends Schema>(
  app: Hono<PluginRouteContext, TSchema>,
  { uid, envs }: EnvironmentRoutesDeps,
) {
  return (
    app
      .get('/environments', async (c) => {
        const all = await envs(c).list(uid(c))
        const environments: EnvironmentInfo[] = all.map(toEnvInfo)
        return c.json({ environments })
      })

      // Mint an environment. Like POST /requests, the name IS the identity, so a collision is a 409
      // rather than a silent overwrite — the editor surfaces it and the user picks another name. The
      // FIRST environment saved becomes active (see the service): otherwise a user creates the only
      // thing that could define their variables and still gets "variable not defined".
      .post('/environments', validated('json', environmentCreateSchema), async (c) => {
        const userId = uid(c)
        const input = c.req.valid('json')
        const name = input.name.trim()
        if (name === '') {
          return c.json(
            {
              error: 'A name is required.',
              code: 'bad_request' as const,
              detail: 'Give the environment a short name, e.g. `staging`.',
            },
            400,
          )
        }
        const variablesProblem = environmentVariablesProblem(input.variables)
        if (variablesProblem) {
          return c.json({ error: variablesProblem, code: 'bad_request' as const }, 400)
        }
        if (await envs(c).get(userId, name)) {
          return c.json(
            {
              error: `An environment named "${name}" already exists.`,
              code: 'name_taken' as const,
              detail: 'Pick a different name, or edit the existing one.',
            },
            409,
          )
        }
        let env: SavedEnvironment
        try {
          env = await envs(c).save(userId, name, input.variables)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'The environment could not be saved.'
          const vaultFailure = /vault/i.test(message)
          return c.json(
            {
              error: message,
              code: vaultFailure ? ('secret_unavailable' as const) : ('bad_request' as const),
            },
            vaultFailure ? 503 : 400,
          )
        }
        return c.json({ environment: toEnvInfo(env) }, 201)
      })

      // Replace an environment's variables wholesale — a PUT REPLACES, so an omitted variable is
      // gone, not merged from the stored copy (the same rule api_client's environment save follows).
      // `save` keeps createdAt and the active flag; only the variable list changes.
      .put('/environments/:name', validated('json', environmentEditSchema), async (c) => {
        const userId = uid(c)
        const name = c.req.param('name')
        if (!(await envs(c).get(userId, name))) {
          return c.json(ENVIRONMENT_NOT_FOUND, 404)
        }
        const { variables } = c.req.valid('json')
        const variablesProblem = environmentVariablesProblem(variables)
        if (variablesProblem) {
          return c.json({ error: variablesProblem, code: 'bad_request' as const }, 400)
        }
        let env: SavedEnvironment
        try {
          env = await envs(c).save(userId, name, variables)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'The environment could not be saved.'
          const vaultFailure = /vault/i.test(message)
          return c.json(
            {
              error: message,
              code: vaultFailure ? ('secret_unavailable' as const) : ('bad_request' as const),
            },
            vaultFailure ? 503 : 400,
          )
        }
        return c.json({ environment: toEnvInfo(env) })
      })

      .post(
        '/environments/:name/rename',
        validated('json', z.object({ to: z.string() })),
        async (c) => {
          const userId = uid(c)
          const from = c.req.param('name')
          const to = c.req.valid('json').to.trim()
          if (!(await envs(c).get(userId, from))) {
            return c.json(ENVIRONMENT_NOT_FOUND, 404)
          }
          if (to === '') {
            return c.json({ error: 'A name is required.', code: 'bad_request' as const }, 400)
          }
          if (to !== from && (await envs(c).get(userId, to))) {
            return c.json(
              {
                error: `An environment named "${to}" already exists.`,
                code: 'name_taken' as const,
              },
              409,
            )
          }
          try {
            const moved = await envs(c).rename(userId, from, to)
            if (!moved) {
              return c.json(ENVIRONMENT_NOT_FOUND, 404)
            }
            return c.json({ environment: toEnvInfo(moved) })
          } catch (error) {
            return c.json(
              {
                error:
                  error instanceof Error ? error.message : 'The environment could not be renamed.',
                code: 'invalid_request' as const,
              },
              422,
            )
          }
        },
      )

      .post('/environments/:name/duplicate', async (c) => {
        const userId = uid(c)
        const source = await envs(c).get(userId, c.req.param('name'))
        if (!source) return c.json(ENVIRONMENT_NOT_FOUND, 404)
        const base = `${source.id}-copy`
        let name = base
        for (let suffix = 2; await envs(c).get(userId, name); suffix++) name = `${base}-${suffix}`
        try {
          const copy = await envs(c).save(
            userId,
            name,
            source.variables.map((variable) => ({ ...variable })),
          )
          return c.json({ environment: toEnvInfo(copy) }, 201)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'The environment could not be duplicated.'
          return c.json(
            {
              error: message,
              code: /vault/i.test(message)
                ? ('secret_unavailable' as const)
                : ('invalid_request' as const),
            },
            /vault/i.test(message) ? 503 : 422,
          )
        }
      })

      // Deleting the ACTIVE environment leaves NONE active rather than promoting a guess — see the
      // service. A missing name is a 404, mirroring every other delete here.
      .delete('/environments/:name', async (c) => {
        const userId = uid(c)
        const name = c.req.param('name')
        if (!(await envs(c).remove(userId, name))) {
          return c.json(ENVIRONMENT_NOT_FOUND, 404)
        }
        return c.json({ ok: true })
      })

      // Registered BEFORE `/:name/use` so the literal segment wins over the param — the one path a
      // user cannot reach by naming an environment "deactivate" is exactly this reserved one.
      .post('/environments/deactivate', async (c) => {
        await envs(c).deactivate(uid(c))
        return c.json({ ok: true })
      })

      .post('/environments/:name/use', async (c) => {
        const env = await envs(c).use(uid(c), c.req.param('name'))
        if (!env) return c.json(ENVIRONMENT_NOT_FOUND, 404)
        return c.json({ ok: true })
      })
  )
}
