import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createActiveEnvironmentStore } from '../collection/active-environment'
import { createFileEnvironmentStore } from '../collection/environments'
import { createFileEnvironmentService } from './file-service'
import type { EnvironmentService } from './service'

let root: string
let stateDir: string
let service: EnvironmentService

const vars = (host: string) => [{ name: 'base_url', value: host }]

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'localix-api-envs-'))
  stateDir = await mkdtemp(path.join(tmpdir(), 'localix-api-state-'))
  service = createFileEnvironmentService(
    createFileEnvironmentStore(root),
    createActiveEnvironmentStore(stateDir),
    root,
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
})

describe('environments are files in the collection', () => {
  test('a save writes one file per environment', async () => {
    await service.save('u', 'staging', vars('https://staging.api.dev'))
    expect(await readdir(path.join(root, 'environments'))).toEqual(['staging.json'])
  })

  test('what is written carries no ACTIVE flag — that is not shared state', async () => {
    // The whole reason the pointer moved out: a colleague's `git pull` must not re-point your
    // next send at their deployment.
    await service.save('u', 'staging', vars('https://staging.api.dev'))
    const text = await Bun.file(path.join(root, 'environments/staging.json')).text()
    expect(text).not.toContain('active')
  })

  test('the list is sorted, so the picker does not reshuffle', async () => {
    await service.save('u', 'prod', vars('https://api.dev'))
    await service.save('u', 'dev', vars('http://localhost:3000'))
    expect((await service.list('u')).map((e) => e.id)).toEqual(['dev', 'prod'])
  })
})

describe('secret variables use the native vault', () => {
  test('a memoized service sees Vault authority bound after mini app inspection', async () => {
    const secrets = new Map<string, string>()
    let nativeVault:
      | {
          storeSecret: (userId: string, key: string, value: string) => Promise<boolean>
          resolveSecret: (userId: string, key: string) => Promise<string | null>
        }
      | undefined
    const inspectedBeforeBoot = createFileEnvironmentService(
      createFileEnvironmentStore(root),
      createActiveEnvironmentStore(stateDir),
      root,
      () => nativeVault ?? {},
    )

    // `register()` is inspected once without a host, then the real backend binds native Vault.
    // The already-created collection service must read that later authority instead of freezing
    // the empty inspection context.
    nativeVault = {
      storeSecret: async (_userId, key, value) => {
        secrets.set(key, value)
        return true
      },
      resolveSecret: async (_userId, key) => secrets.get(key) ?? null,
    }

    await inspectedBeforeBoot.save('u', 'dev', [
      { name: 'token', value: 'late-bound-secret', secret: true },
    ])

    expect(secrets.get('REST_ENV_DEV_TOKEN')).toBe('late-bound-secret')
    expect(await Bun.file(path.join(root, 'environments/dev.json')).text()).not.toContain(
      'late-bound-secret',
    )
  })

  test('a literal is vaulted before disk and resolved only for the wire view', async () => {
    const secrets = new Map<string, string>()
    const bindings: string[] = []
    const vaulted = createFileEnvironmentService(
      createFileEnvironmentStore(root),
      createActiveEnvironmentStore(stateDir),
      root,
      {
        storeSecret: async (_userId, key, value) => {
          if (secrets.has(key)) return false
          secrets.set(key, value)
          return true
        },
        resolveSecret: async (_userId, key) => secrets.get(key) ?? null,
        bindSecret: async (_userId, key) => {
          bindings.push(key)
          return true
        },
      },
    )

    await vaulted.save('u', 'staging', [
      { name: 'base_url', value: 'https://api.dev' },
      { name: 'token', value: 'top-secret-value', secret: true },
    ])

    const text = await Bun.file(path.join(root, 'environments/staging.json')).text()
    expect(text).not.toContain('top-secret-value')
    expect(text).toContain('${secret:REST_ENV_STAGING_TOKEN}')
    expect(text).toContain('"secret": true')
    expect(bindings).toEqual(['REST_ENV_STAGING_TOKEN'])

    expect((await vaulted.activeVars('u')).get('token')).toBe('${secret:REST_ENV_STAGING_TOKEN}')
    expect(
      (await vaulted.activeVars('u', { resolveSecrets: true, requestName: 'users/list' })).get(
        'token',
      ),
    ).toBe('top-secret-value')
  })

  test('a secret literal is refused when Vault is unavailable, never written as plaintext', async () => {
    let failure = ''
    try {
      await service.save('u', 'staging', [{ name: 'token', value: 'do-not-write', secret: true }])
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).toContain('native vault is unavailable')
    expect(await Bun.file(path.join(root, 'environments/staging.json')).exists()).toBe(false)
  })

  test('a blank secret stays unconfigured instead of becoming an empty wire credential', async () => {
    await service.save('u', 'dev', [{ name: 'token', value: '', secret: true }])

    expect((await service.activeVars('u')).has('token')).toBe(false)
  })

  test('rename moves a Vault reference without resolving or re-keying it', async () => {
    const resolved: string[] = []
    const vaulted = createFileEnvironmentService(
      createFileEnvironmentStore(root),
      createActiveEnvironmentStore(stateDir),
      root,
      {
        resolveSecret: async (_userId, key) => {
          resolved.push(key)
          return 'wire-value'
        },
      },
    )
    await vaulted.save('u', 'dev', [
      { name: 'token', value: '${secret:SHARED_TOKEN}', secret: true },
    ])

    await vaulted.rename('u', 'dev', 'local')

    const text = await Bun.file(path.join(root, 'environments/local.json')).text()
    expect(text).toContain('${secret:SHARED_TOKEN}')
    expect(text).not.toContain('wire-value')
    expect(resolved).toEqual([])
  })
})

describe('which one is active', () => {
  test('the FIRST environment saved becomes active', async () => {
    // Otherwise a user saves one, sends, and is told a variable is undefined — having just
    // created the only thing that could define it.
    await service.save('u', 'dev', vars('http://localhost:3000'))
    expect(await service.activeName('u')).toBe('dev')
  })

  test('a later one does NOT steal the pointer', async () => {
    await service.save('u', 'dev', vars('http://localhost:3000'))
    await service.save('u', 'prod', vars('https://api.dev'))
    expect(await service.activeName('u')).toBe('dev')
  })

  test('`use` moves it, and the variables follow', async () => {
    await service.save('u', 'dev', vars('http://localhost:3000'))
    await service.save('u', 'prod', vars('https://api.dev'))
    await service.use('u', 'prod')
    expect(await service.activeName('u')).toBe('prod')
    expect((await service.activeVars('u')).get('base_url')).toBe('https://api.dev')
  })

  test('`use` on an environment that does not exist changes nothing', async () => {
    await service.save('u', 'dev', vars('http://localhost:3000'))
    expect(await service.use('u', 'ghost')).toBeNull()
    expect(await service.activeName('u')).toBe('dev')
  })

  test('deactivating leaves no variables, so a template fails loudly', async () => {
    await service.save('u', 'dev', vars('http://localhost:3000'))
    await service.deactivate('u')
    expect(await service.activeName('u')).toBeNull()
    expect((await service.activeVars('u')).size).toBe(0)
  })

  test('deleting the active one clears the pointer rather than dangling', async () => {
    await service.save('u', 'dev', vars('http://localhost:3000'))
    expect(await service.remove('u', 'dev')).toBe(true)
    expect(await service.activeName('u')).toBeNull()
  })

  test('a pointer at an environment a colleague deleted reads as none', async () => {
    // The pointer is local, the files are shared, so they CAN disagree — after a `git pull` that
    // removed it. "Active" and "exists" must stay the same answer.
    await service.save('u', 'dev', vars('http://localhost:3000'))
    await rm(path.join(root, 'environments/dev.json'))
    expect(await service.activeName('u')).toBeNull()
    expect((await service.activeVars('u')).size).toBe(0)
  })

  test('renaming the active environment moves its pointer and preserves its variables', async () => {
    await service.save('u', 'dev', vars('http://localhost:3000'))
    const moved = await service.rename('u', 'dev', 'local')

    expect(moved?.id).toBe('local')
    expect(await service.get('u', 'dev')).toBeNull()
    expect(await service.activeName('u')).toBe('local')
    expect((await service.activeVars('u')).get('base_url')).toBe('http://localhost:3000')
    const text = await Bun.file(path.join(root, 'environments/local.json')).text()
    expect(text).toContain('"name": "local"')
  })

  test('a rename collision refuses without changing either environment', async () => {
    await service.save('u', 'dev', vars('http://localhost:3000'))
    await service.save('u', 'prod', vars('https://api.dev'))

    expect(service.rename('u', 'dev', 'prod')).rejects.toThrow('already exists')
    expect((await service.list('u')).map((environment) => environment.id)).toEqual(['dev', 'prod'])
    expect(await service.activeName('u')).toBe('dev')
  })
})

describe('two projects do not share a pointer', () => {
  test('each collection remembers its own active environment', async () => {
    const other = await mkdtemp(path.join(tmpdir(), 'localix-api-envs-b-'))
    try {
      // ONE state dir, two collections — the arrangement a second project window produces.
      const second = createFileEnvironmentService(
        createFileEnvironmentStore(other),
        createActiveEnvironmentStore(stateDir),
        other,
      )
      await service.save('u', 'dev', vars('http://localhost:3000'))
      await second.save('u', 'prod', vars('https://api.dev'))

      expect(await service.activeName('u')).toBe('dev')
      expect(await second.activeName('u')).toBe('prod')
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})

describe('names', () => {
  test('an environment name is ONE segment — no folders', async () => {
    expect(service.save('u', 'staging/eu', vars('https://eu.api.dev'))).rejects.toThrow()
  })

  test('a traversing name writes nothing', async () => {
    expect(service.save('u', '../escaped', vars('https://x.dev'))).rejects.toThrow()
    expect(await Bun.file(path.join(root, '../escaped.json')).exists()).toBe(false)
  })
})
