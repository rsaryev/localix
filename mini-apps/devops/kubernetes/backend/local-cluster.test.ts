import { describe, expect, test } from 'bun:test'

import { mapKubeError, toErrorInfo } from './errors'
import { credentialHelperPrerequisite, localClusterPrerequisite } from './local-cluster'

describe('localClusterPrerequisite — a local cluster is down because its engine is', () => {
  test.each([
    ['docker-desktop', 'Docker Desktop', 'open -a Docker'],
    ['orbstack', 'OrbStack', 'open -a OrbStack'],
    ['minikube', 'minikube', 'minikube start'],
    ['colima', 'Colima', 'colima start --kubernetes'],
    ['colima-work', 'Colima', 'colima start --kubernetes --profile work'],
    // kind and k3d are containers: the stopped thing is Docker.
    ['kind-dev', 'Docker', 'open -a Docker'],
    ['k3d-local', 'Docker', 'open -a Docker'],
  ])('%s → start %s with `%s`', (context, name, command) => {
    expect(localClusterPrerequisite(context, 'darwin')).toMatchObject({
      name,
      state: 'stopped',
      command,
    })
  })

  test('a cloud context is not local — Retry is the right answer there', () => {
    expect(localClusterPrerequisite('gke_project_europe-west1_prod', 'darwin')).toBeNull()
    expect(localClusterPrerequisite('', 'darwin')).toBeNull()
  })
})

describe('credential helpers', () => {
  // `executable` contains `exec`, so this used to be filed as `authentication_failed` and sent
  // people to refresh credentials they had no program to refresh with.
  test('a missing helper is tool_missing, naming the program and its install page', () => {
    const mapped = mapKubeError(
      Object.assign(new Error('Executable not found in $PATH: "gke-gcloud-auth-plugin"'), {
        code: 'ENOENT',
      }),
    )
    expect(mapped.code).toBe('tool_missing')
    expect(toErrorInfo(mapped).prerequisite).toMatchObject({
      id: 'gke-gcloud-auth-plugin',
      state: 'missing',
    })
    expect(toErrorInfo(mapped).prerequisite?.installUrl).toStartWith('https://cloud.google.com/')
  })

  test("node's wording names the helper too, and an uncatalogued one has no link", () => {
    expect(credentialHelperPrerequisite('spawn aws ENOENT')?.name).toBe('AWS CLI')
    const unknown = credentialHelperPrerequisite('spawn /opt/bin/my-auth ENOENT')
    expect(unknown).toEqual({ id: 'my-auth', name: 'my-auth', state: 'missing' })
  })

  test('an expired login is still authentication_failed', () => {
    expect(mapKubeError(new Error('error: You must be logged in to the server')).code).toBe(
      'authentication_failed',
    )
  })
})
