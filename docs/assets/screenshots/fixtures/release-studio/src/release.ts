export type ReleaseState = 'planned' | 'in-review' | 'ready'

export interface Release {
  id: string
  title: string
  state: ReleaseState
  checks: { label: string; done: boolean }[]
}

export const release: Release = {
  id: 'v1.4',
  title: 'Workspace update',
  state: 'in-review',
  checks: [
    { label: 'Review the changes', done: true },
    { label: 'Check the mobile layout', done: true },
    { label: 'Publish release notes', done: false },
  ],
}

export function isReady(release: Release): boolean {
  return release.checks.every((check) => check.done)
}
