import { describe, expect, test } from 'bun:test'
import {
  CUSTOM_POD_PORT,
  describePortForwardFailure,
  initialPortForwardChoice,
  parsePortForwardPorts,
  portForwardChoices,
  recommendedContainerPort,
} from '../model/portForward'

const ports = [
  {
    container: 'service',
    name: 'debug',
    port: 4444,
    protocol: 'TCP' as const,
    probe: null,
  },
  {
    container: 'service',
    name: 'grpc',
    port: 5000,
    protocol: 'TCP' as const,
    probe: null,
  },
  {
    container: 'service',
    name: 'http',
    port: 4000,
    protocol: 'TCP' as const,
    probe: 'readiness' as const,
  },
]

describe('port-forward input', () => {
  test('an empty local port asks the OS for an automatic port', () => {
    expect(parsePortForwardPorts('', '80')).toEqual({ localPort: 0, podPort: 80 })
    expect(parsePortForwardPorts('   ', '443')).toEqual({ localPort: 0, podPort: 443 })
  })

  test('an explicit zero is not silently reinterpreted as automatic', () => {
    expect(parsePortForwardPorts('0', '80')).toBeNull()
  })

  test('accepts only integer TCP ports in range', () => {
    expect(parsePortForwardPorts('49152', '8080')).toEqual({
      localPort: 49152,
      podPort: 8080,
    })
    expect(parsePortForwardPorts('65536', '80')).toBeNull()
    expect(parsePortForwardPorts('8080', '0')).toBeNull()
    expect(parsePortForwardPorts('8080.5', '80')).toBeNull()
  })

  test('recommends the probed HTTP listener rather than the first debug declaration', () => {
    expect(recommendedContainerPort(ports)?.port).toBe(4000)
    expect(initialPortForwardChoice(ports)).toBe('4000')
    expect(portForwardChoices(ports).map(({ value }) => value)).toEqual([
      '4000',
      '4444',
      '5000',
      CUSTOM_POD_PORT,
    ])
  })

  test('requires an explicit choice when several declarations have no probe evidence', () => {
    expect(initialPortForwardChoice(ports.map((port) => ({ ...port, probe: null })))).toBe('')
    expect(initialPortForwardChoice([])).toBe(CUSTOM_POD_PORT)
  })

  test('translates the kubelet namespace error into the failed pod endpoint', () => {
    const detail =
      'failed to execute portforward in network namespace: failed to connect to localhost:4444: connection refused'
    expect(describePortForwardFailure(detail, 4444, 'Could not start')).toEqual({
      message: 'Nothing is accepting TCP connections on pod port 4444.',
      detail,
    })
  })
})
