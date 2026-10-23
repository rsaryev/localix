import { Container, ScrollText, Gauge, Cpu, Layers, HardDrive, Network } from 'lucide-react'
import fileTypeDocker from '@iconify-icons/vscode-icons/file-type-docker'

import { resourceMessageBindingDraft, type MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import { detectManifestKind } from './model/dockerManifestCommands'
import { resolveDockerAnchor } from './register/anchor'
import { DockerContainerBody, DockerManifestTab, DockerResourceBody } from './register/bodies'

/**
 * UI registration for the bundled Docker subsystem. The feature contributes its
 * editor-grid WorkItem kinds, search scope, anchors, and manifest editor into the
 * open `uiContrib` registries here instead of core hardcoding Docker anywhere.
 *
 * The body adapters live in `register/bodies.tsx` and URI activation in
 * `register/anchor.ts`, so this file reads as the contribution list it is.
 *
 * The provider intentionally does not own a rail section: the root DevOps mini app
 * composes it with Kubernetes behind the single DevOps Workspace entry.
 */
export function registerDockerContributions(host: MiniAppUiHost): void {
  host.workItems.register({
    kind: 'devops:docker-container',
    Component: DockerContainerBody,
    Icon: Container,
    // Containers are live daemon objects: restoring a saved tab can immediately
    // query an id that no longer exists (or whose logging backend changed).
    restorable: false,
    // A session kind: Exec opens a shell in the chat this tab belongs to.
    agentContext: {
      description: 'Live Docker container details, logs, processes, and stats.',
      nextSteps: [
        'Inspect the selected container state.',
        'Choose the relevant details or logs view.',
      ],
    },
    toMessageBinding: (item) => {
      const id = item.payload?.containerId
      if (typeof id !== 'string' || !id) return null
      const label =
        typeof item.payload?.name === 'string' && item.payload.name ? item.payload.name : item.title
      return resourceMessageBindingDraft({ uri: localixResourceUri('docker', [id]), label })
    },
  })

  host.workItems.register({
    kind: 'devops:docker-resource',
    Component: DockerResourceBody,
    Icon: Layers,
    restorable: false,
    // App-level: an image, volume or network belongs to the machine, and this tab acts for no chat.
    scope: 'global',
    agentContext: {
      description: 'Live Docker image, volume, or network details.',
      nextSteps: [
        'Inspect the selected resource metadata.',
        'Return to the Docker list to choose another resource.',
      ],
    },
    toMessageBinding: (item) => {
      const uri = item.payload?.uri
      if (typeof uri !== 'string' || !uri) return null
      return resourceMessageBindingDraft({ uri, label: item.title })
    },
  })

  // Search owns discovery metadata; the shared UI anchor owns URI activation.
  host.search.register({
    id: 'devops:docker-search',
    scope: {
      label: 'Docker',
      prefix: 'docker',
      aliases: ['container'],
      icon: 'container',
      lazy: true,
      placeholder: 'Search containers, images…',
    },
    icons: { container: Container },
  })
  host.anchors.register({
    id: 'devops:docker-anchor',
    namespaces: ['docker'],
    icons: {
      container: Container,
      logs: ScrollText,
      stats: Gauge,
      processes: Cpu,
      image: Layers,
      volume: HardDrive,
      network: Network,
    },
    resolve: resolveDockerAnchor,
  })

  // Dockerfile / Compose manifests get the Run-bar editor.
  host.fileEditors.register({
    id: 'devops:docker-manifest-editor',
    label: 'Docker manifest',
    match: (p) => detectManifestKind(p) !== null,
    Component: DockerManifestTab,
  })

  // The branded Dockerfile file-tree / tab glyph.
  host.fileIcons.register('dockerfile', fileTypeDocker)
}
