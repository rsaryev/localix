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

interface ActionState {
  containerId: string
  busy: boolean
  error: DevOpsIssue | null
}

const idleAction = (containerId: string): ActionState => ({ containerId, busy: false, error: null })

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
  // An action's progress belongs to the container it was started on: a different container
  // starts idle, with nothing to reset.
  const [actionState, setActionState] = useState<ActionState>(() => idleAction(containerId))
  const { busy, error: actionError } =
    actionState.containerId === containerId ? actionState : idleAction(containerId)
  const dismissActionError = () =>
    setActionState((state) => ({
      ...(state.containerId === containerId ? state : idleAction(containerId)),
      error: null,
    }))
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

  // An action still running on the previous container must not report on this one.
  useEffect(() => {
    actionSeq.current += 1
  }, [containerId])

  const runAction = async (action: DockerContainerAction) => {
    const seq = ++actionSeq.current
    setActionState({ containerId, busy: true, error: null })
    try {
      await dockerApi.action(containerId, action)
      if (seq !== actionSeq.current) return
      await data.refresh(panel, panel === 'logs' && data.logsLive)
    } catch (error) {
      if (seq !== actionSeq.current) return
      setActionState({ containerId, busy: true, error: dockerActionIssue(error) })
    } finally {
      if (seq === actionSeq.current) setActionState((state) => ({ ...state, busy: false }))
    }
  }

  return {
    ...data,
    panel,
    setPanel,
    running,
    busy,
    actionError,
    dismissActionError,
    runAction,
  }
}

export type DockerContainerTabModel = ReturnType<typeof useDockerContainerTab>
