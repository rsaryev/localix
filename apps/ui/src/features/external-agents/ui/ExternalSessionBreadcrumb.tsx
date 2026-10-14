import { ChevronRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { WorkbenchBreadcrumb } from '@localixai/kit/workbench-breadcrumb'
import { localixResourceUri } from '@localixai/plugin-sdk/navigation'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { navigateUi } from '@/shared/lib/uiNavigation'
import {
  EXTERNAL_NAMESPACE,
  externalSessionUri,
  dragExternalResource,
  type ExternalSessionSource,
} from '../model/sessionResource'
import { useInstalledAgents } from '../model/useInstalledAgents'

export function ExternalSessionBreadcrumb({ source }: { source: ExternalSessionSource }) {
  const navigation = useUiNavigation({ sessionId: null })
  const installed = useInstalledAgents()
  const segments = [
    { label: 'External', uri: localixResourceUri(EXTERNAL_NAMESPACE) },
    {
      label:
        installed.agents.find((agent) => agent.id === source.provider)?.name ?? source.provider,
      uri: localixResourceUri(EXTERNAL_NAMESPACE, [source.provider]),
    },
    ...(source.cwd
      ? [
          {
            label: source.cwd.split(/[\\/]/).findLast(Boolean) ?? source.cwd,
            uri: localixResourceUri(EXTERNAL_NAMESPACE, [source.provider, 'cwd', source.cwd]),
          },
        ]
      : []),
    { label: source.title, uri: externalSessionUri(source.key) },
  ]
  return (
    <WorkbenchBreadcrumb
      aria-label="External agent session"
      density="compact"
      bordered
      scrollable
      scrollToEndKey={source.key}
    >
      {segments.map((segment, index) => (
        <li key={segment.uri} className="flex shrink-0 items-center gap-1">
          {index > 0 && <ChevronRight aria-hidden="true" className="size-2.5 opacity-60" />}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 max-w-52 px-1.5 text-2xs"
            title={segment.label}
            aria-current={index === segments.length - 1 ? 'location' : undefined}
            draggable={index === segments.length - 1}
            onDragStart={(event) =>
              dragExternalResource(event.dataTransfer, segment.uri, segment.label)
            }
            onClick={() => {
              if (index < segments.length - 1) navigateUi(segment.uri, navigation)
            }}
          >
            <span className="truncate">{segment.label}</span>
          </Button>
        </li>
      ))}
    </WorkbenchBreadcrumb>
  )
}
