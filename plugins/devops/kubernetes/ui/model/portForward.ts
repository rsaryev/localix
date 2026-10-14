import type { KubeContainerPort, KubePortProbe } from '../../backend/contracts'

export const CUSTOM_POD_PORT = '__custom__'

const PROBE_PRIORITY: readonly KubePortProbe[] = ['readiness', 'startup', 'liveness']

export interface PortForwardChoice {
  value: string
  label: string
  hint: string
  port: KubeContainerPort | null
  recommended: boolean
}

/** A probe is the only strong signal that a declared pod port is expected to answer. */
export function recommendedContainerPort(
  ports: readonly KubeContainerPort[],
): KubeContainerPort | null {
  for (const probe of PROBE_PRIORITY) {
    const match = ports.find((port) => port.probe === probe)
    if (match) return match
  }
  return null
}

export function portForwardChoices(
  ports: readonly KubeContainerPort[],
): readonly PortForwardChoice[] {
  const recommended = recommendedContainerPort(ports)
  const ordered = recommended
    ? [recommended, ...ports.filter((port) => port !== recommended)]
    : [...ports]
  return [
    ...ordered.map((port) => ({
      value: String(port.port),
      label: port.name ? `${port.name} · ${port.port}` : String(port.port),
      hint:
        port === recommended
          ? `Recommended · ${port.probe} probe`
          : [port.container, port.protocol].filter(Boolean).join(' · '),
      port,
      recommended: port === recommended,
    })),
    {
      value: CUSTOM_POD_PORT,
      label: 'Custom pod port…',
      hint: 'Enter a TCP port',
      port: null,
      recommended: false,
    },
  ]
}

export function initialPortForwardChoice(ports: readonly KubeContainerPort[]): string {
  const recommended = recommendedContainerPort(ports)
  if (recommended) return String(recommended.port)
  return ports.length === 0 ? CUSTOM_POD_PORT : ''
}

export function parsePortForwardPorts(
  localPortText: string,
  podPortText: string,
): { localPort: number; podPort: number } | null {
  const automatic = localPortText.trim() === ''
  const localPort = automatic ? 0 : Number(localPortText)
  const podPort = Number(podPortText)
  if (
    !Number.isInteger(localPort) ||
    (!automatic && localPort < 1) ||
    localPort > 65535 ||
    !Number.isInteger(podPort) ||
    podPort < 1 ||
    podPort > 65535
  ) {
    return null
  }
  return { localPort, podPort }
}

export interface PortForwardFailure {
  message: string
  detail?: string
}

/** Translate kubelet/network-namespace wording into the failed endpoint the user controls. */
export function describePortForwardFailure(
  detail: string | undefined,
  podPort: number,
  fallback: string,
): PortForwardFailure {
  const raw = detail?.trim()
  const low = raw?.toLowerCase() ?? ''
  if (
    low.includes('connection refused') ||
    (low.includes('failed to connect to') && low.includes(String(podPort)))
  ) {
    return {
      message: `Nothing is accepting TCP connections on pod port ${podPort}.`,
      detail: raw,
    }
  }
  if (low.includes('timed out') || low.includes('i/o timeout')) {
    return {
      message: `The pod did not accept a connection on port ${podPort} before the timeout.`,
      detail: raw,
    }
  }
  return { message: raw || fallback, ...(raw && raw !== fallback ? { detail: raw } : {}) }
}
