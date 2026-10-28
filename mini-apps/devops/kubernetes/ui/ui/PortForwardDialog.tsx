import { useEffect, useRef, useState } from 'react'
import type { KubeContainerPort, KubePod, PortForward } from '../../backend/contracts'
import { kubernetesApi } from '../api/kubernetesApi'
import { KubeApiError } from '../api/transport'
import {
  CUSTOM_POD_PORT,
  describePortForwardFailure,
  initialPortForwardChoice,
  parsePortForwardPorts,
  portForwardChoices,
  type PortForwardFailure,
} from '../model/portForward'
import { PortForwardDialogView } from './PortForwardDialogView'

function portsOf(pod: KubePod | { name: string } | null): readonly KubeContainerPort[] {
  return pod && 'containerPorts' in pod ? pod.containerPorts : []
}

/**
 * Start a managed Kubernetes API port-forward with an explicit local → pod mapping.
 *
 * A pod's first `containerPort` is not a safe default: it is descriptive metadata and may be a
 * dormant debug port. A readiness/startup/liveness probe is the strong recommendation signal.
 * Ambiguous declarations require an explicit choice.
 */
export function PortForwardDialog({
  pod,
  namespace,
  context,
  owner,
  onClose,
  onStarted,
}: {
  pod: KubePod | { name: string } | null
  namespace: string
  context?: string
  /** Tag the forward with the transient surface (pod tab) that owns it, so it is torn
   * down when that surface closes. Omitted (sidebar) ⇒ the forward persists. */
  owner?: string
  onClose: () => void
  onStarted?: (forward: PortForward) => void
}) {
  const containerPorts = portsOf(pod)
  const choices = portForwardChoices(containerPorts)
  const podKey = pod ? `${context ?? ''}/${namespace}/${pod.name}` : ''
  const [localPort, setLocalPort] = useState('')
  const [portChoice, setPortChoice] = useState(() => initialPortForwardChoice(containerPorts))
  const [customPodPort, setCustomPodPort] = useState('')
  const [busy, setBusy] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [failure, setFailure] = useState<PortForwardFailure | null>(null)
  const requestSeq = useRef(0)
  const activeRequest = useRef<number | null>(null)

  // A watch replaces pod objects even when identity is unchanged. Reset only for
  // a genuinely different target, otherwise an inventory tick would erase input.
  const [lastPodKey, setLastPodKey] = useState(podKey)
  if (lastPodKey !== podKey) {
    setLastPodKey(podKey)
    setPortChoice(initialPortForwardChoice(containerPorts))
    setCustomPodPort('')
    setLocalPort('')
    setValidationError(null)
    setFailure(null)
  }

  // A request still opening a tunnel for the previous target (or for a dialog that is gone) is
  // stale: `start` stops its late forward instead of adopting it.
  useEffect(() => {
    requestSeq.current += 1
  }, [podKey])
  useEffect(
    () => () => {
      requestSeq.current += 1
    },
    [],
  )

  const podPortText = portChoice === CUSTOM_POD_PORT ? customPodPort : portChoice
  const clearIssues = () => {
    setValidationError(null)
    setFailure(null)
  }

  const start = async () => {
    if (!pod || activeRequest.current !== null) return
    if (!portChoice) {
      setValidationError('Choose one of the pod’s TCP ports, or enter a custom port.')
      return
    }
    const ports = parsePortForwardPorts(localPort, podPortText)
    if (!ports) {
      setValidationError('Ports must be whole numbers from 1 to 65535.')
      return
    }
    const seq = ++requestSeq.current
    activeRequest.current = seq
    setBusy(true)
    setValidationError(null)
    setFailure(null)
    try {
      const forward = await kubernetesApi.startPortForward({
        pod: pod.name,
        namespace,
        localPort: ports.localPort,
        podPort: ports.podPort,
        context,
        owner,
      })
      if (seq !== requestSeq.current) {
        // The target changed or the dialog unmounted while Kubernetes was
        // opening the tunnel. Never leave that late forward running invisibly.
        await kubernetesApi.stopPortForward(forward.id).catch(() => {})
        return
      }
      onStarted?.(forward)
      onClose()
    } catch (error) {
      if (seq !== requestSeq.current) return
      if (error instanceof KubeApiError) {
        setFailure(describePortForwardFailure(error.detail, ports.podPort, error.message))
      } else {
        setFailure({ message: 'Could not start the port-forward.' })
      }
    } finally {
      if (activeRequest.current === seq) activeRequest.current = null
      if (seq === requestSeq.current) setBusy(false)
    }
  }

  return (
    <PortForwardDialogView
      open={pod !== null}
      podName={pod?.name ?? ''}
      namespace={namespace}
      ownerScoped={Boolean(owner)}
      choices={choices}
      portChoice={portChoice}
      customPodPort={customPodPort}
      localPort={localPort}
      validationError={validationError}
      failure={failure}
      busy={busy}
      onClose={onClose}
      onPortChoiceChange={(value) => {
        setPortChoice(value)
        clearIssues()
      }}
      onCustomPodPortChange={(value) => {
        setCustomPodPort(value)
        clearIssues()
      }}
      onLocalPortChange={(value) => {
        setLocalPort(value)
        clearIssues()
      }}
      onStart={() => void start()}
    />
  )
}
