import { describe, expect, test } from 'bun:test'

import { reclassifyMissingCli } from './backend'
import { DockerTransportError } from './api-transport'
import { DockerError, dockerStartCommand, mapDockerError, toErrorInfo } from './errors'
import { detectInstalledEngine } from './installed-engine'

describe('mapDockerError — an absent or stopped engine says which, and what to do', () => {
  // The shipped defect, verbatim from the Event Center row: the packaged app could not find the
  // CLI, no pattern matched Bun's wording, and the sidebar read "Docker returned an error."
  test("Bun's missing-executable error is a MISSING engine, not an engine error", () => {
    const err = Object.assign(new Error('Executable not found in $PATH: "docker"'), {
      code: 'ENOENT',
    })
    const mapped = mapDockerError(err, { platform: 'darwin' })
    expect(mapped.code).toBe('engine_unavailable')
    expect(mapped.prerequisite?.state).toBe('missing')
    expect(mapped.prerequisite?.installUrl).toStartWith('https://')
    // The raw text stays the operator detail.
    expect(toErrorInfo(mapped).detail).toContain('Executable not found')
  })

  test('a dead Docker Desktop socket is a STOPPED engine with its start command', () => {
    const mapped = mapDockerError(
      new Error(
        'failed to connect to the docker API at unix:///Users/me/.docker/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /Users/me/.docker/run/docker.sock: connect: no such file or directory',
      ),
      { platform: 'darwin' },
    )
    expect(mapped.prerequisite).toMatchObject({ state: 'stopped', command: 'open -a Docker' })
    expect(toErrorInfo(mapped).prerequisite?.command).toBe('open -a Docker')
  })

  test('an Engine API failure is classified by its status, not its wording', () => {
    const unreachable = mapDockerError(new DockerTransportError('socket went away', 0), {
      platform: 'linux',
    })
    expect(unreachable.code).toBe('engine_unavailable')
    expect(unreachable.prerequisite?.state).toBe('stopped')
    expect(mapDockerError(new DockerTransportError('gone', 404)).code).toBe('not_found')
    // A daemon answer that merely MENTIONS a socket is still the daemon answering.
    const answered = mapDockerError(
      new DockerTransportError('bind mount /var/run/docker.sock: denied', 500),
    )
    expect(answered.code).toBe('engine_error')
  })

  test('an unrelated ENOENT (a missing compose file) is not a stopped engine', () => {
    const err = Object.assign(new Error("ENOENT: open '/srv/app/compose.yaml'"), {
      code: 'ENOENT',
      path: '/srv/app/compose.yaml',
    })
    expect(mapDockerError(err).code).toBe('engine_error')
  })

  test('anything unclassified is still a plain engine error, with no prerequisite', () => {
    const mapped = mapDockerError(new Error('some weird failure'))
    expect(mapped.code).toBe('engine_error')
    expect(mapped.prerequisite).toBeUndefined()
  })
})

describe('dockerStartCommand — the engine the socket names, not a generic "start Docker"', () => {
  test.each([
    ['unix:///Users/me/.orbstack/run/docker.sock', 'darwin', 'open -a OrbStack'],
    ['unix:///Users/me/.colima/default/docker.sock', 'darwin', 'colima start'],
    ['unix:///Users/me/.rd/docker.sock', 'darwin', 'open -a "Rancher Desktop"'],
    ['unix:///var/run/docker.sock', 'darwin', 'open -a Docker'],
    [
      'unix:///home/me/.docker/desktop/docker.sock',
      'linux',
      'systemctl --user start docker-desktop',
    ],
    ['unix:///var/run/docker.sock', 'linux', 'sudo systemctl start docker'],
  ])('%s on %s → %s', (raw, platform, command) => {
    expect(dockerStartCommand(raw, platform)).toBe(command)
  })

  test('Windows gets no command to paste into a bash terminal', () => {
    expect(dockerStartCommand('//./pipe/docker_engine', 'win32')).toBeUndefined()
  })
})

describe('reclassifyMissingCli — a missing CLI on a machine that HAS an engine', () => {
  const missing = () =>
    mapDockerError(new Error('Executable not found in $PATH: "docker"'), { platform: 'darwin' })

  test('says "start it", with that engine\'s command', () => {
    const mapped = reclassifyMissingCli(missing(), () => ({
      name: 'OrbStack',
      command: 'open -a OrbStack',
    }))
    expect(mapped.prerequisite).toMatchObject({ state: 'stopped', command: 'open -a OrbStack' })
  })

  test('stays "install it" when there is no engine at all', () => {
    expect(reclassifyMissingCli(missing(), () => null).prerequisite?.state).toBe('missing')
  })

  test('leaves every other failure untouched', () => {
    const other = new DockerError('not_found', 'No such container: x')
    expect(reclassifyMissingCli(other, () => ({ name: 'Docker Desktop' }))).toBe(other)
  })
})

describe('detectInstalledEngine', () => {
  test('finds Docker Desktop by its app bundle on macOS', () => {
    const engine = detectInstalledEngine({
      platform: 'darwin',
      home: '/Users/me',
      exists: (path) => path === '/Applications/Docker.app',
      which: () => null,
    })
    expect(engine).toEqual({ name: 'Docker Desktop', command: 'open -a Docker' })
  })

  test('finds Colima by its CLI', () => {
    const engine = detectInstalledEngine({
      platform: 'darwin',
      home: '/Users/me',
      exists: () => false,
      which: (name) => (name === 'colima' ? '/opt/homebrew/bin/colima' : null),
    })
    expect(engine?.command).toBe('colima start')
  })

  test('null when nothing is installed', () => {
    expect(
      detectInstalledEngine({ platform: 'darwin', exists: () => false, which: () => null }),
    ).toBeNull()
  })
})
