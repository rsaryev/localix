/** Native-vault handling for environment secret variables. */

import {
  hasSecretTokens,
  resolveSecretTokens,
  type SecretConsumer,
} from '@localixai/mini-app-sdk/backend'
import type { EnvironmentVariable } from './collection/environments'
import { RestError } from './errors'
import type { ResolveSecret } from './secrets'
import type { StoreSecret } from './vault-auth'
import type { BindSecret } from './vault-bindings'

const SECRET_TOKEN_RE = () => /\$\{secret:([A-Za-z0-9_.-]+)\}/g

/** Deterministic environment-variable validation shared by UI, tool and imports. */
export function environmentVariablesProblem(
  variables: readonly EnvironmentVariable[],
): string | null {
  const seen = new Set<string>()
  for (const variable of variables) {
    const name = variable.name.trim()
    if (!name) return 'Every environment variable needs a non-empty "name".'
    if (seen.has(name)) {
      return `Environment variable "${name}" appears more than once. Variable names must be unique.`
    }
    seen.add(name)
  }
  return null
}

function slug(value: string, fallback: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase() || fallback
  )
}

/** Stable, mini-app-scoped starting key; collisions suffix instead of overwriting. */
export function vaultKeyForEnvironment(environment: string, variable: string): string {
  return `REST_ENV_${slug(environment, 'ENV')}_${slug(variable, 'SECRET')}`
}

/** The persisted environment field which references a vault key. */
export function environmentSecretConsumer(environment: string, variable: string): SecretConsumer {
  return {
    type: 'api-environment',
    id: environment,
    field: `variables.${variable}`,
    label: `${environment} · ${variable}`,
  }
}

async function bindReferences(
  userId: string,
  environment: string,
  variable: EnvironmentVariable,
  bindSecret?: BindSecret,
): Promise<void> {
  if (!bindSecret || !hasSecretTokens(variable.value)) return
  for (const match of variable.value.matchAll(SECRET_TOKEN_RE())) {
    const key = match[1]
    if (!key) continue
    try {
      await bindSecret(userId, key, environmentSecretConsumer(environment, variable.name))
    } catch {
      // Binding is vault bookkeeping. The reference remains a valid saved value.
    }
  }
}

/**
 * Turn every secret literal into a vault reference before the environment file is touched.
 * Refusing is safer than falling back to plaintext: `secret: true` is an explicit storage promise.
 */
export async function vaultEnvironmentVariables(
  userId: string,
  environment: string,
  variables: readonly EnvironmentVariable[],
  storeSecret?: StoreSecret,
  bindSecret?: BindSecret,
): Promise<EnvironmentVariable[]> {
  const problem = environmentVariablesProblem(variables)
  if (problem) throw new Error(problem)
  const out: EnvironmentVariable[] = []
  for (const input of variables) {
    const variable: EnvironmentVariable = { ...input, name: input.name.trim() }
    const isSecret = variable.secret === true || hasSecretTokens(variable.value)
    if (!isSecret) {
      out.push({
        name: variable.name,
        value: variable.value,
        ...(variable.disabled ? { disabled: true } : {}),
      })
      continue
    }

    variable.secret = true
    if (variable.value !== '' && !hasSecretTokens(variable.value)) {
      if (!storeSecret) {
        throw new RestError(
          'secret_unavailable',
          `Variable "${variable.name}" is marked secret, but the native vault is unavailable. Nothing was saved.`,
        )
      }
      const base = vaultKeyForEnvironment(environment, variable.name)
      let key: string | null = null
      for (let n = 1; n <= 20; n += 1) {
        const candidate = n === 1 ? base : `${base}_${n}`
        if (await storeSecret(userId, candidate, variable.value)) {
          key = candidate
          break
        }
      }
      if (!key) {
        throw new RestError(
          'secret_unavailable',
          `Variable "${variable.name}" could not be moved into the native vault. Nothing was saved.`,
        )
      }
      variable.value = `\${secret:${key}}`
    }
    await bindReferences(userId, environment, variable, bindSecret)
    out.push(variable)
  }
  return out
}

/** Resolve secret references for the outgoing wire request only. */
export async function resolveEnvironmentVariable(
  userId: string,
  environment: string,
  variable: EnvironmentVariable,
  resolveSecret: ResolveSecret,
): Promise<string> {
  if (!hasSecretTokens(variable.value)) return variable.value
  return resolveSecretTokens(variable.value, (key) =>
    resolveSecret(userId, key, environmentSecretConsumer(environment, variable.name)),
  )
}
