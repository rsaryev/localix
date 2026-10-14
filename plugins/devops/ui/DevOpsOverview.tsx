import {
  AlertTriangle,
  Box,
  ChevronRight,
  Container,
  Layers,
  Network,
  Server,
  Ship,
} from 'lucide-react'

import { OverviewRegistryRow } from '@localixai/kit/overview-registry-row'
import type { DockerWorkbenchModel } from '../docker/ui/model/useDocker'
import type { KubernetesWorkbenchModel } from '../kubernetes/ui/model/useKubernetes'
import { devOpsOverviewSnapshot } from './model/devopsOverview'
import type { DevOpsArea } from './model/devopsView'

export function DevOpsOverview({
  docker,
  kubernetes,
  onOpen,
}: {
  docker: DockerWorkbenchModel
  kubernetes: KubernetesWorkbenchModel
  onOpen: (area: Exclude<DevOpsArea, 'overview'>) => void
}) {
  const snapshot = devOpsOverviewSnapshot(docker, kubernetes)

  return (
    <div className="scrollbar-thin h-full min-h-0 overflow-y-auto px-4 py-4 @2xl:px-6">
      <div className="flex w-full flex-col gap-4">
        <section aria-label="Providers">
          <div className="grid gap-3 @lg:grid-cols-2">
            <OverviewRegistryRow
              title="Container engine"
              icon={Container}
              onOpen={() => onOpen('containers')}
              metrics={[
                {
                  icon: Box,
                  label: 'Running',
                  value: docker.resourceErrors.containers
                    ? '—'
                    : `${snapshot.docker.running}/${snapshot.docker.containers}`,
                },
                {
                  icon: Layers,
                  label: 'Images',
                  value: docker.resourceErrors.images ? '—' : snapshot.docker.images,
                },
                {
                  icon: Network,
                  label: 'Projects',
                  value: docker.resourceErrors.containers ? '—' : snapshot.docker.projects,
                },
              ]}
            />
            <OverviewRegistryRow
              title="Kubernetes"
              icon={Ship}
              onOpen={() => onOpen('kubernetes')}
              metrics={[
                {
                  icon: Box,
                  label: 'Pods',
                  value: kubernetes.resourceErrors.pods
                    ? '—'
                    : `${snapshot.kubernetes.pods.ready}/${snapshot.kubernetes.pods.total}`,
                },
                {
                  icon: Layers,
                  label: 'Deploy',
                  value: kubernetes.resourceErrors.deployments
                    ? '—'
                    : `${snapshot.kubernetes.deployments.ready}/${snapshot.kubernetes.deployments.total}`,
                },
                {
                  icon: Server,
                  label: 'Nodes',
                  value: kubernetes.resourceErrors.nodes
                    ? '—'
                    : `${snapshot.kubernetes.nodes.ready}/${snapshot.kubernetes.nodes.total}`,
                },
              ]}
            />
          </div>
        </section>

        {snapshot.issues.length > 0 && (
          <section aria-labelledby="devops-attention">
            <h2
              id="devops-attention"
              className="mb-1.5 px-0.5 text-2xs font-semibold uppercase tracking-wider text-text-faint"
            >
              Attention
            </h2>
            <div className="divide-y divide-border-soft border-y border-border-soft">
              {snapshot.issues.map((issue) => (
                <button
                  key={issue.key}
                  type="button"
                  onClick={() => onOpen(issue.area)}
                  className="group flex w-full items-start gap-2 px-1 py-2 text-left outline-none transition-colors hover:bg-surface-hover focus-ring"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-status-warning" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {issue.label}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-2xs leading-relaxed text-text-faint">
                      {issue.detail}
                    </span>
                  </span>
                  <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
