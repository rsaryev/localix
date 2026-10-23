import type { Prerequisite } from '@localixai/mini-app-sdk/prerequisite'

/**
 * The thing to START when a LOCAL cluster does not answer, and the thing to INSTALL when the
 * kubeconfig's credential helper is not on this machine.
 *
 * "Cannot reach this cluster right now" with a Retry is the right answer for a cloud cluster on a
 * flaky VPN, and the wrong one for `docker-desktop` or `kind-dev`: those clusters are down because
 * the engine under them is stopped, and no amount of retrying starts it. The context NAME is how
 * every local distribution identifies itself, so it is enough to name the command.
 *
 * Pure and browser-safe, like `errors.ts`.
 */

const DOCKER_INSTALL_URL = 'https://docs.docker.com/get-started/get-docker/'

function engine(
  id: string,
  name: string,
  command: string | undefined,
  installUrl = DOCKER_INSTALL_URL,
): Prerequisite {
  return { id, name, state: 'stopped', installUrl, ...(command ? { command } : {}) }
}

/** The stopped engine behind a local context, or null for a context that is not local. */
export function localClusterPrerequisite(
  context: string | null | undefined,
  platform: string,
): Prerequisite | null {
  if (!context) return null
  const name = context.toLowerCase()
  const mac = platform === 'darwin'
  if (name === 'docker-desktop' || name === 'docker-for-desktop') {
    return engine(
      'docker',
      'Docker Desktop',
      mac
        ? 'open -a Docker'
        : platform === 'linux'
          ? 'systemctl --user start docker-desktop'
          : undefined,
    )
  }
  if (name === 'orbstack')
    return engine(
      'orbstack',
      'OrbStack',
      mac ? 'open -a OrbStack' : 'orb start',
      'https://orbstack.dev/download',
    )
  if (name === 'rancher-desktop') {
    return engine(
      'rancher-desktop',
      'Rancher Desktop',
      mac ? 'open -a "Rancher Desktop"' : undefined,
      'https://rancherdesktop.io/',
    )
  }
  if (name === 'colima' || name.startsWith('colima-')) {
    const profile = name === 'colima' ? '' : ` --profile ${name.slice('colima-'.length)}`
    return engine(
      'colima',
      'Colima',
      `colima start --kubernetes${profile}`,
      'https://github.com/abiosoft/colima#installation',
    )
  }
  if (name === 'minikube') {
    return engine(
      'minikube',
      'minikube',
      'minikube start',
      'https://minikube.sigs.k8s.io/docs/start/',
    )
  }
  // kind and k3d clusters are containers: the engine under them is what is stopped. Their own
  // tools restart the containers once Docker is back, so Docker is the prerequisite to name.
  if (name.startsWith('kind-') || name.startsWith('k3d-')) {
    return engine(
      'docker',
      'Docker',
      mac ? 'open -a Docker' : platform === 'linux' ? 'sudo systemctl start docker' : undefined,
    )
  }
  return null
}

/** Install pages for the credential helpers kubeconfigs commonly `exec`. */
const CREDENTIAL_HELPERS: Record<string, { name: string; installUrl: string }> = {
  'gke-gcloud-auth-plugin': {
    name: 'gke-gcloud-auth-plugin',
    installUrl:
      'https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl#install_plugin',
  },
  gcloud: { name: 'Google Cloud CLI', installUrl: 'https://cloud.google.com/sdk/docs/install' },
  aws: {
    name: 'AWS CLI',
    installUrl: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
  },
  'aws-iam-authenticator': {
    name: 'aws-iam-authenticator',
    installUrl:
      'https://docs.aws.amazon.com/eks/latest/userguide/install-aws-iam-authenticator.html',
  },
  kubelogin: { name: 'kubelogin', installUrl: 'https://azure.github.io/kubelogin/install.html' },
  az: { name: 'Azure CLI', installUrl: 'https://learn.microsoft.com/cli/azure/install-azure-cli' },
  doctl: {
    name: 'doctl',
    installUrl: 'https://docs.digitalocean.com/reference/doctl/how-to/install/',
  },
  oci: {
    name: 'OCI CLI',
    installUrl: 'https://docs.oracle.com/iaas/Content/API/SDKDocs/cliinstall.htm',
  },
}

/**
 * The missing credential helper a spawn failure names — `Executable not found in $PATH:
 * "gke-gcloud-auth-plugin"`, `spawn aws ENOENT` — as a prerequisite to install. A helper nobody
 * catalogued is still named; it just has no link.
 */
export function credentialHelperPrerequisite(raw: string): Prerequisite | null {
  const match =
    /executable not found in \$path: "([^"]+)"/i.exec(raw) ??
    /spawn(?:sync)? (\S+) enoent/i.exec(raw) ??
    /(\S+): command not found/i.exec(raw)
  if (!match) return null
  const command = match[1]!.split(/[\\/]/).pop()!
  const known = CREDENTIAL_HELPERS[command]
  return {
    id: command,
    name: known?.name ?? command,
    state: 'missing',
    ...(known ? { installUrl: known.installUrl } : {}),
  }
}
