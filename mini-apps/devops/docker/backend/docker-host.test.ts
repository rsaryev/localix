import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  contextMetaPath,
  defaultDockerHost,
  dockerConfigDir,
  parseDockerHost,
  resolveDockerTransport,
  type HostEnvironment,
} from './docker-host'

/** A machine: env, platform, home, and a fake filesystem of path → contents. */
function machine(over: {
  env?: Record<string, string | undefined>
  platform?: string
  homeDir?: string
  files?: Record<string, string>
}): HostEnvironment {
  const files = over.files ?? {}
  return {
    env: over.env ?? {},
    platform: over.platform ?? 'darwin',
    homeDir: over.homeDir ?? '/Users/dev',
    readTextFile: (path) => files[path] ?? null,
  }
}

const metaFor = (host: string, name = 'desktop-linux') => ({
  path: `/Users/dev/.docker/contexts/meta/${createHash('sha256').update(name).digest('hex')}/meta.json`,
  json: JSON.stringify({
    Name: name,
    Endpoints: { docker: { Host: host, SkipTLSVerify: false } },
  }),
})

describe('defaultDockerHost', () => {
  test('the two platform default Docker hosts', () => {
    expect(defaultDockerHost('win32')).toBe('npipe:////./pipe/docker_engine')
    expect(defaultDockerHost('darwin')).toBe('unix:///var/run/docker.sock')
    expect(defaultDockerHost('linux')).toBe('unix:///var/run/docker.sock')
  })
})

describe('parseDockerHost', () => {
  test('unix sockets', () => {
    expect(parseDockerHost('unix:///var/run/docker.sock')).toEqual({
      kind: 'unix',
      path: '/var/run/docker.sock',
    })
    // What a real Docker Desktop context on macOS records.
    expect(parseDockerHost('unix:///Users/dev/.docker/run/docker.sock')).toEqual({
      kind: 'unix',
      path: '/Users/dev/.docker/run/docker.sock',
    })
  })

  test('a named pipe URL becomes the Win32 path the kernel wants', () => {
    // moby's own conversion: strip the scheme, then slashes become backslashes.
    expect(parseDockerHost('npipe:////./pipe/docker_engine')).toEqual({
      kind: 'npipe',
      path: '\\\\.\\pipe\\docker_engine',
    })
  })

  test('bare paths are accepted, as a hand-set DOCKER_HOST produces them', () => {
    expect(parseDockerHost('/var/run/docker.sock')).toEqual({
      kind: 'unix',
      path: '/var/run/docker.sock',
    })
    expect(parseDockerHost('\\\\.\\pipe\\docker_engine')).toEqual({
      kind: 'npipe',
      path: '\\\\.\\pipe\\docker_engine',
    })
  })

  test('plain TCP daemons are spoken natively', () => {
    expect(parseDockerHost('tcp://192.168.1.10:2375')).toEqual({
      kind: 'tcp',
      baseUrl: 'http://192.168.1.10:2375',
    })
    expect(parseDockerHost('http://localhost:2375/')).toEqual({
      kind: 'tcp',
      baseUrl: 'http://localhost:2375',
    })
  })

  test('SSH and TLS hosts fall back to the CLI, WITH a reason', () => {
    // Both are real setups. Answering them with a half-built native client would be worse
    // than answering them with the tool that already handles them.
    const ssh = parseDockerHost('ssh://user@build-box')
    expect(ssh.kind).toBe('cli')
    expect(ssh.kind === 'cli' && ssh.reason).toContain('SSH')
    const tls = parseDockerHost('https://daemon.internal:2376')
    expect(tls.kind).toBe('cli')
    expect(tls.kind === 'cli' && tls.reason).toContain('certificates')
  })

  test('an unknown scheme is a stated fallback, not a crash', () => {
    const weird = parseDockerHost('quic://nope')
    expect(weird).toMatchObject({ kind: 'cli' })
    expect(parseDockerHost('   ')).toMatchObject({ kind: 'cli' })
  })
})

describe('dockerConfigDir', () => {
  test('DOCKER_CONFIG wins over the home directory', () => {
    expect(dockerConfigDir(machine({ env: { DOCKER_CONFIG: '/etc/docker-cfg' } }))).toBe(
      '/etc/docker-cfg',
    )
    expect(dockerConfigDir(machine({}))).toBe('/Users/dev/.docker')
  })
})

describe('contextMetaPath', () => {
  test('the directory is the hex sha256 of the context NAME', () => {
    // Verified against a real store: Docker Desktop created exactly this directory for
    // `desktop-linux` on the machine this was written on.
    expect(contextMetaPath(machine({}), 'desktop-linux')).toBe(
      '/Users/dev/.docker/contexts/meta/fe9c6bd7a66301f49ca9b6a70b217107cd1284598bfc254700c989b916da791e/meta.json',
    )
  })
})

describe('resolveDockerTransport', () => {
  test('DOCKER_HOST beats a configured context', () => {
    const meta = metaFor('unix:///Users/dev/.docker/run/docker.sock')
    expect(
      resolveDockerTransport(
        machine({
          env: { DOCKER_HOST: 'tcp://10.0.0.5:2375' },
          files: {
            '/Users/dev/.docker/config.json': JSON.stringify({ currentContext: 'desktop-linux' }),
            [meta.path]: meta.json,
          },
        }),
      ),
    ).toEqual({ kind: 'tcp', baseUrl: 'http://10.0.0.5:2375' })
  })

  test('the selected context is read from the store — the real Docker Desktop case', () => {
    // THE case a hardcoded /var/run/docker.sock gets wrong: the user socket is the endpoint,
    // and the /var/run symlink is a Docker Desktop courtesy that other runtimes never create.
    const meta = metaFor('unix:///Users/dev/.docker/run/docker.sock')
    expect(
      resolveDockerTransport(
        machine({
          files: {
            '/Users/dev/.docker/config.json': JSON.stringify({ currentContext: 'desktop-linux' }),
            [meta.path]: meta.json,
          },
        }),
      ),
    ).toEqual({ kind: 'unix', path: '/Users/dev/.docker/run/docker.sock' })
  })

  test('DOCKER_CONTEXT overrides the config file', () => {
    const meta = metaFor('tcp://remote:2375', 'work')
    expect(
      resolveDockerTransport(
        machine({
          env: { DOCKER_CONTEXT: 'work' },
          files: {
            '/Users/dev/.docker/config.json': JSON.stringify({ currentContext: 'desktop-linux' }),
            [meta.path]: meta.json,
          },
        }),
      ),
    ).toEqual({ kind: 'tcp', baseUrl: 'http://remote:2375' })
  })

  test('the context named `default` is the platform daemon, not a store lookup', () => {
    // Windows writes `default` into the config, and there is no meta directory for it.
    expect(
      resolveDockerTransport(
        machine({
          platform: 'win32',
          files: {
            '/Users/dev/.docker/config.json': JSON.stringify({ currentContext: 'default' }),
          },
        }),
      ),
    ).toEqual({ kind: 'npipe', path: '\\\\.\\pipe\\docker_engine' })
  })

  test('a context recording an empty host falls through to the default', () => {
    // `docker context create foo --docker "host="` produces this and the CLI tolerates it.
    const meta = metaFor('', 'foo')
    expect(
      resolveDockerTransport(
        machine({
          env: { DOCKER_CONTEXT: 'foo' },
          files: { [meta.path]: meta.json },
        }),
      ),
    ).toEqual({ kind: 'unix', path: '/var/run/docker.sock' })
  })

  test('an unreadable or corrupt store does not break resolution', () => {
    // A broken config must degrade to the platform default, not take the workbench down.
    const stores: Record<string, string>[] = [
      {},
      { '/Users/dev/.docker/config.json': 'not json at all' },
      { '/Users/dev/.docker/config.json': JSON.stringify({ currentContext: 'missing-ctx' }) },
    ]
    for (const files of stores) {
      expect(resolveDockerTransport(machine({ files }))).toEqual({
        kind: 'unix',
        path: '/var/run/docker.sock',
      })
    }
  })

  test('no config at all on Windows still resolves to the named pipe', () => {
    expect(resolveDockerTransport(machine({ platform: 'win32' }))).toEqual({
      kind: 'npipe',
      path: '\\\\.\\pipe\\docker_engine',
    })
  })
})
