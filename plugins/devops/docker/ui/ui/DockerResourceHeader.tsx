import { HardDrive, Layers, Network as NetworkIcon } from 'lucide-react'
import { RefreshAction } from '@localixai/kit/refresh-action'
import type { DockerResourceDetail } from '../model/dockerResourceDetail'
import type { DockerResourceDetailModel } from '../model/useDockerResourceDetail'

export function DockerResourceHeader({
  kind,
  model,
}: {
  kind: DockerResourceDetail['kind']
  model: DockerResourceDetailModel
}) {
  const Icon = kind === 'image' ? Layers : kind === 'volume' ? HardDrive : NetworkIcon

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2">
      <span className="flex size-5 shrink-0 items-center justify-center text-text-faint">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{model.label}</span>
        <span className="truncate text-2xs capitalize text-text-faint">Docker {kind}</span>
      </span>
      <RefreshAction
        size="sm"
        aria-label="Refresh resource"
        tooltip="Refresh resource"
        disabled={model.loading}
        busy={model.loading}
        onClick={() => void model.refresh()}
      />
    </header>
  )
}
