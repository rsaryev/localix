import { afterAll, beforeAll, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ResourceContextButton } from '@localixai/kit/resource-context-button'
import { registerDom } from '@localixai/kit/testing'
import { ContainerRow } from './ContainerRow'
import { DockerContainerListHeader } from './DockerListHeader'
import { ResourceRow } from './ResourceRow'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

test('the whole resource row is draggable without a duplicate link control', () => {
  const html = renderToStaticMarkup(
    <ResourceRow
      icon={<span>icon</span>}
      label="api:latest"
      meta="10 MB"
      dragUri="localix://resource/docker/image/sha256%3Aabc"
      dragLabel="api:latest"
      onOpen={() => {}}
      onRemove={() => {}}
    />,
  )

  expect(html).toContain('api:latest · open details')
  expect(html).not.toContain('Link api:latest to chat')
  expect(html.match(/draggable="true"/g)).toHaveLength(1)
  expect(html).toContain('role="listitem" draggable="true"')
  expect(html).toContain('data-resource-uri="localix://resource/docker/image/sha256%3Aabc"')
  expect(html).toContain('lx-hover-actions')
})

test('a normal resource click still opens details on a draggable row', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  let opened = 0

  try {
    await act(async () =>
      root.render(
        <ResourceRow
          icon={<span>icon</span>}
          label="api:latest"
          meta="10 MB"
          dragUri="localix://resource/docker/image/sha256%3Aabc"
          dragLabel="api:latest"
          onOpen={() => opened++}
        />,
      ),
    )

    const row = host.querySelector<HTMLElement>('[role="listitem"]')!
    const open = host.querySelector<HTMLButtonElement>('[title="api:latest · open details"]')!

    expect(row.getAttribute('draggable')).toBe('true')
    await act(async () => open.click())
    expect(opened).toBe(1)
    await act(async () => row.click())
    expect(opened).toBe(2)
  } finally {
    await act(async () => root.unmount())
  }
})

test('keeps an empty action cell so protected networks do not shift table columns', () => {
  const html = renderToStaticMarkup(
    <ResourceRow
      icon={<span>icon</span>}
      label="bridge"
      meta="bridge"
      secondaryMeta="local"
      dragUri="localix://resource/docker/network/bridge"
      onOpen={() => {}}
    />,
  )

  expect(html).not.toContain('data-resource-column="link"')
  expect(html).toContain('data-resource-column="action"')
  expect(html).not.toContain('aria-label="Remove"')
})

test('container headers and rows share panel-width columns with one action cell', () => {
  const header = renderToStaticMarkup(<DockerContainerListHeader />)
  const row = renderToStaticMarkup(
    <ContainerRow
      container={{
        id: 'abc',
        name: 'api',
        image: 'api:latest',
        state: 'running',
        status: 'Up 3 minutes',
        ports: '127.0.0.1:8080→80/tcp',
        createdAt: '2026-07-24T00:00:00Z',
      }}
      busy={false}
      confirmingRemove={false}
      actions={{
        onOpen: () => {},
        onStart: () => {},
        onStop: () => {},
        onRestart: () => {},
        onRemoveRequest: () => {},
        onRemoveCancel: () => {},
        onRemoveConfirm: () => {},
      }}
    />,
  )

  const wideGrid = '@3xl:grid-cols-[minmax(0,1fr)_10rem_8rem_11rem_4.75rem]'
  expect(header).toContain(wideGrid)
  expect(row).toContain(wideGrid)
  expect(row).toContain('@xl:hidden')
  expect(row).not.toContain('data-resource-column="link"')
  expect(row).toContain('data-resource-column="action"')
})

test('the full resource link action is also a native drag handle', () => {
  const html = renderToStaticMarkup(
    <ResourceContextButton
      mode="action"
      uri="localix://resource/k8s/prod/apps/web/manifest"
      label="deployment web manifest"
    />,
  )

  expect(html).toContain('draggable="true"')
  expect(html).toContain('Link deployment web manifest to chat')
  expect(html).toContain('drag into the input')
  expect(html).toContain('@max-sm:sr-only')
  expect(html).toContain('Link')
})
