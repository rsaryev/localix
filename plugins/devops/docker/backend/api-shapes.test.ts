import { describe, expect, test } from 'bun:test'
import {
  containerFromApi,
  containersFromApi,
  imagesFromApi,
  networksFromApi,
  topFromApi,
  volumesFromApi,
} from './api-shapes'
import { formatApiPorts } from './api-ports'

type ApiPortFixture = NonNullable<Parameters<typeof formatApiPorts>[0]>[number]

const port = (over: Partial<ApiPortFixture> = {}) => ({
  IP: '0.0.0.0',
  PrivatePort: 80,
  PublicPort: 80,
  Type: 'tcp',
  ...over,
})

describe('formatApiPorts', () => {
  test('a published port reads as a self-mapping, as docker ps prints it', () => {
    expect(formatApiPorts([port({ PrivatePort: 5672, PublicPort: 5672 })])).toBe(
      '0.0.0.0:5672->5672/tcp',
    )
  })

  test('an IPv6 host is bracketed', () => {
    // Verified against `docker ps` on a dual-stack publication: `[::]:5672->5672/tcp`.
    expect(formatApiPorts([port({ IP: '::', PrivatePort: 5672, PublicPort: 5672 })])).toBe(
      '[::]:5672->5672/tcp',
    )
  })

  test('dual-stack publications keep both, ordered by IP', () => {
    expect(
      formatApiPorts([
        port({ IP: '::', PrivatePort: 5672, PublicPort: 5672 }),
        port({ IP: '0.0.0.0', PrivatePort: 5672, PublicPort: 5672 }),
      ]),
    ).toBe('0.0.0.0:5672->5672/tcp, [::]:5672->5672/tcp')
  })

  test('consecutive private ports collapse into a range', () => {
    // Not guessable from the payload: docker/cli groups runs, so a container publishing
    // 8000..8003 shows one entry, not four.
    expect(
      formatApiPorts([8000, 8001, 8002, 8003].map((p) => port({ PrivatePort: p, PublicPort: p }))),
    ).toBe('0.0.0.0:8000-8003->8000-8003/tcp')
  })

  test('a gap in the run splits the groups', () => {
    expect(
      formatApiPorts([8000, 8001, 9000].map((p) => port({ PrivatePort: p, PublicPort: p }))),
    ).toBe('0.0.0.0:8000-8001->8000-8001/tcp, 0.0.0.0:9000->9000/tcp')
  })

  test('a REMAPPED publication is pulled out and appended last', () => {
    // The other non-guessable rule: 8080->80 cannot be a self-mapping group, so docker/cli
    // emits it after every grouped entry.
    expect(
      formatApiPorts([
        port({ PrivatePort: 80, PublicPort: 8080 }),
        port({ PrivatePort: 443, PublicPort: 443 }),
      ]),
    ).toBe('0.0.0.0:443->443/tcp, 0.0.0.0:8080->80/tcp')
  })

  test('an unpublished port has no host part', () => {
    expect(formatApiPorts([{ PrivatePort: 5432, Type: 'tcp' }])).toBe('5432/tcp')
  })

  test('the protocol is carried through', () => {
    expect(formatApiPorts([port({ PrivatePort: 53, PublicPort: 53, Type: 'udp' })])).toBe(
      '0.0.0.0:53->53/udp',
    )
  })

  test('no ports is an empty string, not a stray separator', () => {
    expect(formatApiPorts([])).toBe('')
    expect(formatApiPorts(undefined)).toBe('')
  })
})

describe('containerFromApi', () => {
  const raw = {
    Id: 'abc123',
    Names: ['/acme-rabbitmq', '/alias'],
    Image: 'rabbitmq:3.11',
    State: 'running',
    Status: 'Up 2 hours',
    Created: 1785228628,
    Ports: [port({ PrivatePort: 5672, PublicPort: 5672 })],
    Labels: {
      'com.docker.compose.project': 'acme',
      'com.docker.compose.service': 'rabbitmq',
    },
  }

  test('maps a row, taking the FIRST name and trimming its slash', () => {
    expect(containerFromApi(raw)).toEqual({
      id: 'abc123',
      name: 'acme-rabbitmq',
      image: 'rabbitmq:3.11',
      state: 'running',
      status: 'Up 2 hours',
      ports: '0.0.0.0:5672->5672/tcp',
      createdAt: '2026-07-28T08:50:28.000Z',
      project: 'acme',
      service: 'rabbitmq',
    })
  })

  test('compose labels are unambiguous over the API', () => {
    // The CLI joins labels with commas, and compose writes comma-joined path lists into
    // `config_files` — indistinguishable in that flat string, which is why `parseLabels` has
    // to guess. A real object cannot be ambiguous.
    const withCommas = containerFromApi({
      ...raw,
      Labels: {
        'com.docker.compose.project': 'acme',
        'com.docker.compose.project.config_files': '/a/compose.yml,/b/override.yml',
      },
    })
    expect(withCommas?.project).toBe('acme')
  })

  test('an unknown state normalises the same way as on the CLI path', () => {
    expect(containerFromApi({ ...raw, State: 'nonsense' })?.state).toBe('exited')
  })

  test('Created is seconds since the epoch, not milliseconds', () => {
    // Reading it as ms would date every container to 1970.
    expect(containerFromApi({ Id: 'x', Created: 1785228628 })?.createdAt).toBe(
      '2026-07-28T08:50:28.000Z',
    )
    expect(containerFromApi({ Id: 'x' })?.createdAt).toBe('')
  })

  test('a non-compose container carries no project/service keys at all', () => {
    const plain = containerFromApi({ Id: 'x', Labels: {} })
    expect(plain).not.toHaveProperty('project')
    expect(plain).not.toHaveProperty('service')
  })

  test('an entry with no id is dropped rather than keyed as empty', () => {
    expect(containerFromApi({ Names: ['/x'] })).toBeNull()
    expect(containerFromApi(null)).toBeNull()
    expect(containerFromApi('nope')).toBeNull()
  })
})

describe('containersFromApi', () => {
  test('maps a list and skips unusable entries', () => {
    expect(containersFromApi([{ Id: 'a' }, null, { Names: ['/no-id'] }, { Id: 'b' }])).toHaveLength(
      2,
    )
  })
  test('a non-array body yields no rows', () => {
    expect(containersFromApi({ message: 'error' })).toEqual([])
    expect(containersFromApi(null)).toEqual([])
  })
})

describe('imagesFromApi', () => {
  test('expands tags and preserves registry ports', () => {
    expect(
      imagesFromApi([
        {
          Id: 'sha256:abc',
          RepoTags: ['postgres:16', 'registry.local:5000/team/api:dev'],
          Size: 142_000_000,
          Created: 1785228628,
        },
      ]),
    ).toEqual([
      {
        id: 'sha256:abc',
        repository: 'postgres',
        tag: '16',
        size: '142MB',
        sizeBytes: 142_000_000,
        createdAt: '2026-07-28T08:50:28.000Z',
      },
      {
        id: 'sha256:abc',
        repository: 'registry.local:5000/team/api',
        tag: 'dev',
        size: '142MB',
        sizeBytes: 142_000_000,
        createdAt: '2026-07-28T08:50:28.000Z',
      },
    ])
  })

  test('renders an untagged image like docker images', () => {
    expect(imagesFromApi([{ Id: 'sha256:none', RepoTags: [], Size: 0 }])[0]).toMatchObject({
      repository: '<none>',
      tag: '<none>',
      size: '0B',
    })
  })
})

describe('volumesFromApi', () => {
  test('maps the Engine volume wrapper field-for-field', () => {
    expect(volumesFromApi({ Volumes: [{ Name: 'db', Driver: 'local', Scope: 'local' }] })).toEqual([
      { name: 'db', driver: 'local', scope: 'local' },
    ])
  })

  test('handles a null Volumes result', () => {
    expect(volumesFromApi({ Volumes: null })).toEqual([])
  })
})

describe('networksFromApi', () => {
  test('maps list rows and skips an entry without an id', () => {
    expect(
      networksFromApi([
        { Id: 'net1', Name: 'bridge', Driver: 'bridge', Scope: 'local' },
        { Name: 'unaddressable' },
      ]),
    ).toEqual([{ id: 'net1', name: 'bridge', driver: 'bridge', scope: 'local' }])
  })
})

describe('topFromApi', () => {
  test('renames Titles and keeps process cells intact', () => {
    expect(
      topFromApi({
        Titles: ['UID', 'PID', 'CMD'],
        Processes: [['root', '42', 'sleep 10']],
      }),
    ).toEqual({
      headers: ['UID', 'PID', 'CMD'],
      processes: [['root', '42', 'sleep 10']],
    })
  })

  test('drops malformed rows instead of leaking untyped values', () => {
    expect(topFromApi({ Titles: ['PID', 42], Processes: [['1'], [2]] })).toEqual({
      headers: ['PID'],
      processes: [['1']],
    })
  })
})
