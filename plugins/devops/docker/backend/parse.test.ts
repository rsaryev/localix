import { describe, expect, test } from 'bun:test'
import {
  deriveStateFromStatus,
  normalizeState,
  parseComposeProjectPaths,
  parseContainers,
  parseImages,
  parseLabels,
  parseNetworks,
  parseStats,
  parseTop,
  parseVolumes,
} from './parse'
import { mapDockerError, DockerError } from './errors'
import { createDockerBackend } from './backend'
import { createDockerService } from './service'

describe('parseStats', () => {
  test('strips % and coerces junk to 0', () => {
    const out = parseStats(
      [
        JSON.stringify({
          ID: 'a',
          CPUPerc: '0.15%',
          MemPerc: '1.2%',
          MemUsage: '12MiB / 2GiB',
          NetIO: '1.2kB / 0B',
          BlockIO: '0B / 0B',
          PIDs: '3',
        }),
        JSON.stringify({ ID: 'b', CPUPerc: '--', MemPerc: '', PIDs: 'x' }),
      ].join('\n'),
    )
    expect(out[0]).toEqual({
      id: 'a',
      cpuPct: 0.15,
      memPct: 1.2,
      memUsage: '12MiB / 2GiB',
      netIO: '1.2kB / 0B',
      blockIO: '0B / 0B',
      // Decimal, because `NetIO`/`BlockIO` go through Docker's HumanSize (kB), unlike
      // `MemUsage` which is BytesSize (MiB). Reading 1.2kB as 1.2KiB would be a 2.4% error.
      netRxBytes: 1_200,
      netTxBytes: 0,
      blockReadBytes: 0,
      blockWriteBytes: 0,
      pids: 3,
    })
    expect(out[1]).toMatchObject({ cpuPct: 0, memPct: 0, pids: 0 })
  })

  test('a counter Docker could not report is null, never 0', () => {
    // `--network host`, Windows containers and rootless/cgroup-v2 hosts print `--`.
    // Reporting that as 0 bytes would claim the container sent no traffic.
    const out = parseStats(
      JSON.stringify({ ID: 'a', CPUPerc: '1%', NetIO: '--', BlockIO: '-- / --', PIDs: '1' }),
    )
    expect(out[0]).toMatchObject({
      netRxBytes: null,
      netTxBytes: null,
      blockReadBytes: null,
      blockWriteBytes: null,
    })
  })

  test('each side of a pair is judged on its own', () => {
    const out = parseStats(JSON.stringify({ ID: 'a', NetIO: '4.1MB / --', PIDs: '1' }))
    expect(out[0]).toMatchObject({ netRxBytes: 4_100_000, netTxBytes: null })
  })
})

describe('parseTop', () => {
  test('keeps a space-containing CMD as one final column', () => {
    const out = parseTop(
      'UID PID PPID CMD\nroot 100 1 nginx: master process /etc/nginx\nfoo 200 100 sh',
    )
    expect(out.headers).toEqual(['UID', 'PID', 'PPID', 'CMD'])
    expect(out.processes[0]).toEqual(['root', '100', '1', 'nginx: master process /etc/nginx'])
    expect(out.processes[1]).toEqual(['foo', '200', '100', 'sh'])
  })
  test('empty output → empty table', () => {
    expect(parseTop('')).toEqual({ headers: [], processes: [] })
  })
})

describe('parseVolumes/parseNetworks', () => {
  test('skip malformed lines', () => {
    expect(
      parseVolumes('not json\n' + JSON.stringify({ Name: 'v', Driver: 'local', Scope: 'local' })),
    ).toEqual([{ name: 'v', driver: 'local', scope: 'local' }])
    expect(
      parseNetworks(JSON.stringify({ ID: 'n', Name: 'host', Driver: 'host', Scope: 'local' })),
    ).toEqual([{ id: 'n', name: 'host', driver: 'host', scope: 'local' }])
  })
})

describe('parseContainers', () => {
  test('parses line-delimited JSON from docker ps', () => {
    const stdout = [
      JSON.stringify({
        ID: 'abc123',
        Names: '/pg',
        Image: 'postgres:16',
        State: 'running',
        Status: 'Up 3 hours',
        Ports: '0.0.0.0:5432->5432/tcp',
        CreatedAt: '2026-07-01 10:00:00 +0000 UTC',
      }),
      JSON.stringify({
        ID: 'def456',
        Names: 'redis',
        Image: 'redis:7',
        State: 'exited',
        Status: 'Exited (0) 2 minutes ago',
        Ports: '',
        CreatedAt: '2026-07-01 09:00:00 +0000 UTC',
      }),
    ].join('\n')
    const rows = parseContainers(stdout)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: 'abc123',
      name: 'pg',
      state: 'running',
      ports: '0.0.0.0:5432->5432/tcp',
    })
    expect(rows[1]).toMatchObject({ id: 'def456', name: 'redis', state: 'exited' })
  })

  test('trims a single leading slash and takes the first of comma-joined names', () => {
    const stdout = JSON.stringify({ ID: 'x', Names: '/web,/web-alias', State: 'running' })
    expect(parseContainers(stdout)[0]?.name).toBe('web')
  })

  test('skips blank and malformed lines rather than failing the whole listing', () => {
    const stdout = [
      '',
      '{not json}',
      JSON.stringify({ ID: 'ok', Names: 'ok', State: 'running' }),
      '  ',
    ].join('\n')
    const rows = parseContainers(stdout)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('ok')
  })

  test('returns [] for empty output', () => {
    expect(parseContainers('')).toEqual([])
  })

  test('derives compose project/service from labels', () => {
    const stdout = [
      JSON.stringify({
        ID: 'c1',
        Names: 'app-web-1',
        State: 'running',
        Labels: 'com.docker.compose.project=app,com.docker.compose.service=web,maintainer=me',
      }),
      JSON.stringify({ ID: 'c2', Names: 'lonely', State: 'running', Labels: 'foo=bar' }),
    ].join('\n')
    const rows = parseContainers(stdout)
    expect(rows[0]).toMatchObject({ id: 'c1', project: 'app', service: 'web' })
    expect(rows[1]?.project).toBeUndefined()
    expect(rows[1]?.service).toBeUndefined()
  })
})

describe('parseLabels', () => {
  test('splits a comma/equals joined label string', () => {
    expect(parseLabels('a=1,b=2,com.docker.compose.service=web')).toEqual({
      a: '1',
      b: '2',
      'com.docker.compose.service': 'web',
    })
  })
  test('ignores blanks and keyless entries', () => {
    expect(parseLabels('')).toEqual({})
    expect(parseLabels('novalue,=orphan,k=v')).toEqual({ k: 'v' })
  })
  test('re-attaches comma-continuations of a value (config_files has multiple paths)', () => {
    // Docker joins BOTH pairs and multi-value labels with commas; a keyless segment
    // continues the previous value rather than being dropped.
    expect(
      parseLabels(
        'com.docker.compose.project=app,com.docker.compose.project.config_files=/a/compose.yml,/a/override.yml,com.docker.compose.project.working_dir=/a',
      ),
    ).toEqual({
      'com.docker.compose.project': 'app',
      'com.docker.compose.project.config_files': '/a/compose.yml,/a/override.yml',
      'com.docker.compose.project.working_dir': '/a',
    })
  })
})

describe('normalizeState', () => {
  test('passes canonical states through', () => {
    expect(normalizeState('running')).toBe('running')
    expect(normalizeState('PAUSED')).toBe('paused')
  })
  test('unknown/empty falls back to exited', () => {
    expect(normalizeState('weird')).toBe('exited')
    expect(normalizeState(undefined)).toBe('exited')
  })
})

describe('deriveStateFromStatus', () => {
  test('matches (Paused) before Up', () => {
    expect(deriveStateFromStatus('Up 3 hours (Paused)')).toBe('paused')
  })
  test('maps the leading status word to a state', () => {
    expect(deriveStateFromStatus('Up 3 hours')).toBe('running')
    expect(deriveStateFromStatus('Restarting (1) 2 seconds ago')).toBe('restarting')
    expect(deriveStateFromStatus('Created')).toBe('created')
    expect(deriveStateFromStatus('Removal In Progress')).toBe('removing')
    expect(deriveStateFromStatus('Dead')).toBe('dead')
    expect(deriveStateFromStatus('Exited (0) 2 minutes ago')).toBe('exited')
    expect(deriveStateFromStatus('')).toBe('exited')
  })
})

describe('parseContainers legacy output (no .State field)', () => {
  test('derives state from Status when State is blank', () => {
    const stdout = [
      JSON.stringify({ ID: 'a', Names: 'up', Status: 'Up 2 hours' }),
      JSON.stringify({ ID: 'b', Names: 'paused', Status: 'Up 2 hours (Paused)' }),
      JSON.stringify({ ID: 'c', Names: 'gone', Status: 'Exited (0) 5 minutes ago' }),
      JSON.stringify({ ID: 'd', Names: 'boot', Status: 'Restarting (1) 1 second ago' }),
    ].join('\n')
    const rows = parseContainers(stdout)
    expect(rows.map((r) => r.state)).toEqual(['running', 'paused', 'exited', 'restarting'])
  })
  test('modern output still uses the .State field', () => {
    // A blank Status but a present State must not be overridden.
    const stdout = JSON.stringify({ ID: 'x', Names: 'x', State: 'exited', Status: 'Up 1 hour' })
    expect(parseContainers(stdout)[0]?.state).toBe('exited')
  })
})

describe('parseComposeProjectPaths', () => {
  test('recovers working_dir + config_files from the first labelled container', () => {
    const stdout = JSON.stringify({
      ID: 'c1',
      Labels:
        'com.docker.compose.project=app,com.docker.compose.project.working_dir=/srv/app,com.docker.compose.project.config_files=/srv/app/docker-compose.yml',
    })
    expect(parseComposeProjectPaths(stdout)).toEqual({
      workingDir: '/srv/app',
      configFiles: ['/srv/app/docker-compose.yml'],
    })
  })
  test('recovers ALL config_files for a multi-file project (not just the first)', () => {
    const stdout = JSON.stringify({
      ID: 'c1',
      Labels:
        'com.docker.compose.project=app,com.docker.compose.project.config_files=/srv/app/docker-compose.yml,/srv/app/docker-compose.override.yml',
    })
    expect(parseComposeProjectPaths(stdout)).toEqual({
      configFiles: ['/srv/app/docker-compose.yml', '/srv/app/docker-compose.override.yml'],
    })
  })
  test('returns null when no container carries a compose location label', () => {
    expect(parseComposeProjectPaths(JSON.stringify({ ID: 'c1', Labels: 'foo=bar' }))).toBeNull()
    expect(parseComposeProjectPaths('')).toBeNull()
  })
})

describe('parseImages', () => {
  test('parses docker images json lines', () => {
    const stdout = JSON.stringify({
      ID: 'sha256:aaa',
      Repository: 'postgres',
      Tag: '16',
      Size: '142MB',
      CreatedAt: '2 weeks ago',
    })
    const rows = parseImages(stdout)
    expect(rows[0]).toMatchObject({
      id: 'sha256:aaa',
      repository: 'postgres',
      tag: '16',
      size: '142MB',
      sizeBytes: 142_000_000,
    })
  })
})

describe('a dead socket is an absent engine, not a missing object', () => {
  // Reported from Docker Desktop on macOS. Its tail is "no such file or directory", which the
  // `no such ` branch claimed before any engine pattern matched it — so a stopped daemon was
  // announced to the person as "No such Docker object."
  const DEAD_SOCKET =
    'connect to the docker API at unix:///Users/me/.docker/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /Users/me/.docker/run/docker.sock: connect: no such file or directory'

  test('classifies as engine_unavailable, with a sentence a person can act on', () => {
    const mapped = mapDockerError(new Error(DEAD_SOCKET))
    expect(mapped.code).toBe('engine_unavailable')
    expect(mapped.friendly).toBe(
      'Docker is not available — is Docker installed and the daemon running?',
    )
  })

  test('a genuinely missing container is still not_found', () => {
    expect(mapDockerError(new Error('Error: No such container: abc123')).code).toBe('not_found')
  })
})

describe('mapDockerError', () => {
  test('missing binary / daemon down → engine_unavailable', () => {
    expect(
      mapDockerError(
        new Error(
          'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
        ),
      ).code,
    ).toBe('engine_unavailable')
    expect(mapDockerError(new Error('spawn docker ENOENT')).code).toBe('engine_unavailable')
    expect(mapDockerError(new Error('Docker command timed out after 10000ms')).code).toBe(
      'engine_unavailable',
    )
    expect(
      mapDockerError(
        new Error(
          'failed to connect to the docker API at unix:///tmp/missing.sock; check if the path is correct and if the daemon is running: dial unix /tmp/missing.sock: connect: no such file or directory',
        ),
      ).code,
    ).toBe('engine_unavailable')
  })
  test('no such container/object/volume/network/image → not_found', () => {
    expect(mapDockerError(new Error('Error: No such container: bogus')).code).toBe('not_found')
    expect(mapDockerError(new Error('Error: No such object: bogus')).code).toBe('not_found')
    expect(mapDockerError(new Error('Error: No such volume: v1')).code).toBe('not_found')
    expect(mapDockerError(new Error('Error: No such network: n1')).code).toBe('not_found')
    expect(mapDockerError(new Error('Error: No such image: img:tag')).code).toBe('not_found')
  })
  test('other → engine_error', () => {
    expect(mapDockerError(new Error('some weird failure')).code).toBe('engine_error')
  })
  test('passes an existing DockerError through unchanged', () => {
    const e = new DockerError('action_failed')
    expect(mapDockerError(e)).toBe(e)
  })
})

describe('createDockerBackend (injected exec)', () => {
  test('list/logs/actions call the CLI with expected args and map errors', async () => {
    const calls: string[][] = []
    const backend = createDockerBackend({
      exec: async (args) => {
        calls.push(args)
        if (args[0] === 'ps') return JSON.stringify({ ID: 'c1', Names: 'c1', State: 'running' })
        if (args[0] === 'images')
          return JSON.stringify({ ID: 'i1', Repository: 'r', Tag: 'latest', Size: '1MB' })
        if (args[0] === 'logs') return 'line1\nline2\n'
        return ''
      },
    })
    expect((await backend.listContainers())[0]?.id).toBe('c1')
    expect((await backend.listImages())[0]?.id).toBe('i1')
    expect((await backend.containerLogs('c1', 50, 6)).lines).toContain('line1')
    await backend.startContainer('c1')
    await backend.removeContainer('c1', true)
    expect(calls.find((a) => a[0] === 'logs')).toEqual([
      'logs',
      '--tail',
      '50',
      '--timestamps',
      '--since',
      '6s',
      'c1',
    ])
    expect(calls.find((a) => a[0] === 'rm')).toEqual(['rm', '-f', 'c1'])
  })

  test('stats/top/volumes/networks are wired to their parsers', async () => {
    const backend = createDockerBackend({
      exec: async (args) => {
        if (args[0] === 'stats')
          return JSON.stringify({
            ID: 'c1',
            CPUPerc: '1.50%',
            MemPerc: '2.00%',
            MemUsage: '10MiB / 2GiB',
            NetIO: '1kB / 0B',
            BlockIO: '0B / 0B',
            PIDs: '4',
          })
        if (args[0] === 'top') return 'UID PID CMD\nroot 1 nginx: master process'
        if (args[0] === 'volume')
          return JSON.stringify({ Name: 'v1', Driver: 'local', Scope: 'local' })
        if (args[0] === 'network')
          return JSON.stringify({ ID: 'n1', Name: 'bridge', Driver: 'bridge', Scope: 'local' })
        if (args[0] === 'container' && args[1] === 'prune') return 'Total reclaimed space: 0B'
        return ''
      },
    })
    expect(await backend.containerStats('c1')).toMatchObject({ cpuPct: 1.5, memPct: 2, pids: 4 })
    expect((await backend.containerTop('c1')).processes[0]).toEqual([
      'root',
      '1',
      'nginx: master process',
    ])
    expect(await backend.listVolumes()).toEqual([{ name: 'v1', driver: 'local', scope: 'local' }])
    expect(await backend.listNetworks()).toEqual([
      { id: 'n1', name: 'bridge', driver: 'bridge', scope: 'local' },
    ])
    expect(await backend.prune('containers')).toEqual({
      target: 'containers',
      output: 'Total reclaimed space: 0B',
    })
  })

  test('a thrown exec surfaces as a typed DockerError', async () => {
    const backend = createDockerBackend({
      exec: async () => {
        throw new Error('Cannot connect to the Docker daemon. Is the docker daemon running?')
      },
    })
    expect(backend.listContainers()).rejects.toMatchObject({ code: 'engine_unavailable' })
  })

  test('composeAvailable probes `compose version` (true on success, false on throw)', async () => {
    const ok = createDockerBackend({ exec: async () => '' })
    expect(await ok.composeAvailable()).toBe(true)
    const missing = createDockerBackend({
      exec: async () => {
        throw new Error('unknown command "compose"')
      },
    })
    expect(await missing.composeAvailable()).toBe(false)
  })

  test('removeImage runs `rmi [-f] <id>`', async () => {
    const calls: string[][] = []
    const backend = createDockerBackend({
      exec: async (args) => {
        calls.push(args)
        return ''
      },
    })
    await backend.removeImage('img1', false)
    await backend.removeImage('img2', true)
    expect(calls[0]).toEqual(['rmi', 'img1'])
    expect(calls[1]).toEqual(['rmi', '-f', 'img2'])
  })

  test('composeUp runs from the project working_dir recovered from container labels', async () => {
    const calls: { args: string[]; cwd?: string }[] = []
    const backend = createDockerBackend({
      exec: async (args, opts) => {
        calls.push({ args, cwd: opts?.cwd })
        if (args[0] === 'ps') {
          return JSON.stringify({
            ID: 'c1',
            Labels:
              'com.docker.compose.project=myproj,com.docker.compose.project.working_dir=/srv/myproj',
          })
        }
        return ''
      },
    })
    await backend.composeUp('myproj')
    // First a filtered ps to recover the location, then compose from that cwd.
    expect(calls[0]?.args[0]).toBe('ps')
    expect(calls[0]?.args).toContain('label=com.docker.compose.project=myproj')
    expect(calls[1]?.args).toEqual(['compose', '-p', 'myproj', 'up', '-d'])
    expect(calls[1]?.cwd).toBe('/srv/myproj')
  })

  test('composeUp falls back to explicit -f config files when working_dir is absent', async () => {
    const calls: string[][] = []
    const backend = createDockerBackend({
      exec: async (args) => {
        calls.push(args)
        if (args[0] === 'ps') {
          return JSON.stringify({
            ID: 'c1',
            Labels:
              'com.docker.compose.project=p,com.docker.compose.project.config_files=/etc/p/compose.yml',
          })
        }
        return ''
      },
    })
    await backend.composeUp('p')
    expect(calls[1]).toEqual(['compose', '-f', '/etc/p/compose.yml', '-p', 'p', 'up', '-d'])
  })

  test('composeUp passes EVERY -f config file for a multi-file project', async () => {
    const calls: string[][] = []
    const backend = createDockerBackend({
      exec: async (args) => {
        calls.push(args)
        if (args[0] === 'ps') {
          return JSON.stringify({
            ID: 'c1',
            Labels:
              'com.docker.compose.project=p,com.docker.compose.project.config_files=/etc/p/compose.yml,/etc/p/compose.prod.yml',
          })
        }
        return ''
      },
    })
    await backend.composeUp('p')
    expect(calls[1]).toEqual([
      'compose',
      '-f',
      '/etc/p/compose.yml',
      '-f',
      '/etc/p/compose.prod.yml',
      '-p',
      'p',
      'up',
      '-d',
    ])
  })

  test('composeUp throws a typed error when the manifest location is unrecoverable', async () => {
    const backend = createDockerBackend({
      exec: async (args) =>
        args[0] === 'ps' ? JSON.stringify({ ID: 'c1', Labels: 'foo=bar' }) : '',
    })
    expect(backend.composeUp('ghost')).rejects.toMatchObject({ code: 'action_failed' })
  })
})

describe('createDockerService (compose memoization)', () => {
  test('composeAvailable probes the backend once and caches the result', async () => {
    let probes = 0
    const backend = createDockerBackend({
      exec: async (args) => {
        if (args[0] === 'compose' && args[1] === 'version') probes++
        return ''
      },
    })
    const service = createDockerService({ backend })
    expect(await service.composeAvailable()).toBe(true)
    expect(await service.composeAvailable()).toBe(true)
    expect(probes).toBe(1)
  })
})
