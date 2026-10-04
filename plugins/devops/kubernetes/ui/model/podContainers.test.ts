import { describe, expect, test } from 'bun:test'
import type { KubePod } from '../../backend/contracts'
import {
  ALL_CONTAINERS,
  containerLabel,
  logRequestFor,
  podContainerOptions,
  podContainerValues,
  reconcileContainerSelection,
} from './podContainers'

const pod = (containers: string[], initContainers: string[] = []) =>
  ({ containers, initContainers }) as Pick<KubePod, 'containers' | 'initContainers'>

describe('podContainerValues', () => {
  test('init containers come first, in run order', () => {
    expect(podContainerValues(pod(['app', 'proxy'], ['migrate']))).toEqual([
      'migrate',
      'app',
      'proxy',
    ])
  })
  test('no pod yields nothing', () => {
    expect(podContainerValues(null)).toEqual([])
  })
})

describe('podContainerOptions', () => {
  test('a single-container pod offers no choice at all', () => {
    // An "all containers" entry would just be a second name for the same output.
    expect(podContainerOptions(pod(['app']))).toEqual([])
  })

  test('an init container alone still makes the selector worth showing', () => {
    // The case the old `containers.length > 1` check missed entirely: a pod stuck at
    // Init:0/1 has exactly one app container and one init container with the answer.
    expect(podContainerOptions(pod(['app'], ['migrate'])).map((o) => o.value)).toEqual([
      ALL_CONTAINERS,
      'migrate',
      'app',
    ])
  })

  test('init containers are labelled as such', () => {
    // Their logs stop when they exited; the label prevents waiting on a dead live stream.
    const options = podContainerOptions(pod(['app'], ['migrate']))
    expect(options.find((o) => o.value === 'migrate')?.label).toBe('migrate · init')
    expect(options.find((o) => o.value === 'app')?.label).toBe('app')
  })
})

describe('reconcileContainerSelection', () => {
  test('a still-present container is kept', () => {
    expect(reconcileContainerSelection('proxy', pod(['app', 'proxy']))).toBe('proxy')
  })

  test('a container that disappeared falls back to the first APP container', () => {
    // Not the first init container: on a healthy pod that has already exited, so it would
    // present a dead stream as the default view.
    expect(reconcileContainerSelection('sidecar', pod(['app'], ['migrate']))).toBe('app')
  })

  test('all-containers survives a refresh', () => {
    expect(reconcileContainerSelection(ALL_CONTAINERS, pod(['app', 'proxy']))).toBe(ALL_CONTAINERS)
  })

  test('all-containers collapses to the only container when the pod has just one', () => {
    expect(reconcileContainerSelection(ALL_CONTAINERS, pod(['app']))).toBe('app')
  })

  test('a vanished pod leaves an empty selection rather than a stale name', () => {
    expect(reconcileContainerSelection('app', null)).toBe('')
    expect(reconcileContainerSelection(ALL_CONTAINERS, null)).toBe('')
  })
})

describe('logRequestFor', () => {
  test('a named container asks for that container', () => {
    expect(logRequestFor('proxy')).toEqual({ container: 'proxy' })
  })
  test('all-containers asks the backend to interleave, and names no container', () => {
    // Sending both would be contradictory — the backend treats a named container as the
    // more specific ask and would silently ignore the interleave.
    expect(logRequestFor(ALL_CONTAINERS)).toEqual({ allContainers: true })
  })
  test('an empty selection lets the server pick the default container', () => {
    expect(logRequestFor('')).toEqual({ container: undefined })
  })
})

describe('containerLabel', () => {
  test('reads as prose in a header or filename', () => {
    expect(containerLabel(ALL_CONTAINERS)).toBe('all containers')
    expect(containerLabel('proxy')).toBe('proxy')
  })
})
