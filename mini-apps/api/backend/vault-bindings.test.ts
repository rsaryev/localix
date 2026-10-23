import { describe, expect, test } from 'bun:test'
import type { SecretConsumer } from '@localixai/mini-app-sdk/backend'
import type { RequestAuth } from './request-spec'
import { authSecretReferences, bindAuthSecrets } from './vault-bindings'

const bearer = (token: string): RequestAuth => ({ type: 'bearer', token })

describe('which keys an auth block references', () => {
  test('a bearer token reference is found, with the field that holds it', () => {
    expect(authSecretReferences(bearer('${secret:GITHUB_TOKEN}'))).toEqual([
      { key: 'GITHUB_TOKEN', field: 'token' },
    ])
  })

  test('basic auth binds the PASSWORD, not the username', () => {
    // The username is an identifier, not a credential — the field table already says so, and
    // binding it would tell the vault about a key that does not exist.
    const auth: RequestAuth = {
      type: 'basic',
      username: 'ada',
      password: '${secret:PG_PASSWORD}',
    }
    expect(authSecretReferences(auth)).toEqual([{ key: 'PG_PASSWORD', field: 'password' }])
  })

  test('an api key binds its VALUE, not its header name', () => {
    const auth: RequestAuth = { type: 'apikey', key: 'X-Api-Key', value: '${secret:SVC}' }
    expect(authSecretReferences(auth)).toEqual([{ key: 'SVC', field: 'value' }])
  })

  test('several references in one field are all found', () => {
    expect(authSecretReferences(bearer('${secret:A}.${secret:B}'))).toEqual([
      { key: 'A', field: 'token' },
      { key: 'B', field: 'token' },
    ])
  })

  test('a LITERAL credential references nothing — there is no key to bind', () => {
    expect(authSecretReferences(bearer('ghp_realtokenvalue'))).toEqual([])
    expect(authSecretReferences({ type: 'none' })).toEqual([])
  })

  test('a malformed token is not mistaken for a key', () => {
    expect(authSecretReferences(bearer('${secret:}'))).toEqual([])
  })
})

describe('registering the references', () => {
  test('each key is bound to the request, naming the field', async () => {
    const calls: Array<{ key: string; consumer: SecretConsumer }> = []
    const bound = await bindAuthSecrets(
      'user-a',
      'github-user',
      bearer('${secret:GITHUB_TOKEN}'),
      async (_userId, key, consumer) => {
        calls.push({ key, consumer })
        return true
      },
    )
    expect(bound).toEqual(['GITHUB_TOKEN'])
    expect(calls).toEqual([
      {
        key: 'GITHUB_TOKEN',
        consumer: {
          type: 'api-request',
          id: 'github-user',
          field: 'auth.token',
          label: 'github-user',
        },
      },
    ])
  })

  test('a key the vault does not have is reported as unbound, not as an error', async () => {
    const bound = await bindAuthSecrets('u', 'r', bearer('${secret:GONE}'), async () => false)
    expect(bound).toEqual([])
  })

  test('a THROWING vault never takes the save down with it', async () => {
    // The whole point of best-effort: the request is already saved and works. A binding is
    // bookkeeping, and `bind` is an upsert, so the next save repairs it.
    const bound = await bindAuthSecrets('u', 'r', bearer('${secret:K}'), async () => {
      throw new Error('vault unavailable')
    })
    expect(bound).toEqual([])
  })

  test('a host with no binding registry is a silent no-op', async () => {
    expect(await bindAuthSecrets('u', 'r', bearer('${secret:K}'), undefined)).toEqual([])
  })
})
