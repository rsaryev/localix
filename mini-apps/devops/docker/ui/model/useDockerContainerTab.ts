import { useCallback, useEffect, useRef, useState } from 'react'
import { resourceMessageBindingDraft, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { dockerApi } from '../dockerApi'
import type { DevOpsIssue } from '../../../ui/DevOpsProblem'
import { dockerActionIssue } from './useDockerSidebarActions'
import {
  dockerContainerSection,
  loadDockerContainerPanel,
  saveDockerContainerPanel,
  type DockerContainerPanel,
} from './containerPanel'
import { useDockerContainerData } from './useDockerContainerData'
import { dockerContainerUri } from './openTab'

export type DockerContainerAction = 'start' | 'stop' | 'restart'

export function useDockerContainerTab({
  active,
  containerId,
  name,
  publishMessageContext,
}: {
  active: boolean
  containerId: string
  name: string
  publishMessageContext?: PublishMessageContext
}) {
  const [panel, setPanelState] = useState<DockerContainerPanel>(loadDockerContainerPanel)
  const [actionError, setActionError] = useState<DevOpsIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const actionSeq = useRef(0)
  const data = useDockerContainerData({ active, containerId, panel })
  const running = data.container?.state === 'running' || data.container?.state === 'restarting'

  const setPanel = useCallback((next: DockerContainerPanel) => {
    setPanelState(next)
    saveDockerContainerPanel(next)
  }, [])

  useEffect(() => {
    if (!publishMessageContext || !containerId) return
    const section = dockerContainerSection(panel)
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: `${dockerContainerUri(containerId)}/${section}`,
          label: `${data.container?.name ?? name} ${section}`,
        }),
      ],
    })
  }, [containerId, data.container?.name, name, panel, publishMessageContext])

  useEffect(() => {
    actionSeq.current += 1
    setActionError(null)
    setBusy(false)
  }, [containerId])

  const runAction = async (action: DockerContainerAction) => {
    const seq = ++actionSeq.current
    setBusy(true)
    setActionError(null)
    try {
      await dockerApi.action(containerId, action)
      if (seq !== actionSeq.current) return
      await data.refresh(panel, panel === 'logs' && data.logsLive)
    } catch (error) {
      if (seq !== actionSeq.current) return
      setActionError(dockerActionIssue(error))
    } finally {
      if (seq === actionSeq.current) setBusy(false)
    }
  }

  return {
    ...data,
    panel,
    setPanel,
    running,
    busy,
    actionError,
    dismissActionError: () => setActionError(null),
    runAction,
  }
}

export type DockerContainerTabModel = ReturnType<typeof useDockerContainerTab>
