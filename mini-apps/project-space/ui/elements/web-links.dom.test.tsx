import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { registerDom } from '@localixai/kit/testing'
import { viewOf } from './index'
import { LinkForm } from './WebLink'

let teardown: () => Promise<void>
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  environment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  delete environment.IS_REACT_ACT_ENVIRONMENT
})

test('a note offers a web link without opening it while selecting or editing text', async () => {
  const opened: string[] = []
  const unbind = bindMiniAppUiRuntime({
    external: { open: (url: string) => opened.push(url) },
  } as unknown as MiniAppUiRuntime)
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const View = viewOf('note')!.View
  const props = {
    id: 'n',
    props: { text: 'Read https://example.com/guide.', color: 'yellow', size: 'md' },
    width: 200,
    height: 200,
    editing: false,
    selected: false,
    missing: false,
    sessionId: '',
    stamp: 0,
    commit: () => undefined,
    resize: () => undefined,
    stopEditing: () => undefined,
  }
  try {
    await act(async () => root.render(<View {...props} />))
    expect(host.textContent).toBe(props.props.text)
    expect(opened).toEqual([])
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label^="Link options"]')!.click(),
    )
    expect(opened).toEqual([])
    const open = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Open website'),
    )!
    await act(async () => open.click())
    expect(opened).toEqual(['https://example.com/guide'])
    await act(async () => root.render(<View {...props} editing />))
    expect(host.querySelector('textarea')?.value).toBe(props.props.text)
    expect(host.querySelector('[aria-label^="Link options"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    unbind()
  }
})

test('a link card has a visible open action and its form saves a normalized address', async () => {
  const opened: string[] = []
  const saved: unknown[] = []
  const unbind = bindMiniAppUiRuntime({
    external: { open: (url: string) => opened.push(url) },
  } as unknown as MiniAppUiRuntime)
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const View = viewOf('link')!.View
  try {
    await act(async () =>
      root.render(
        <View
          id="l"
          props={{ url: 'https://example.com/guide', title: 'Guide' }}
          width={300}
          height={76}
          editing={false}
          selected={false}
          missing={false}
          sessionId=""
          stamp={0}
          commit={() => undefined}
          resize={() => undefined}
          stopEditing={() => undefined}
        />,
      ),
    )
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Open website: example.com"]')!.click(),
    )
    expect(opened).toEqual(['https://example.com/guide'])
    await act(async () =>
      root.render(
        <LinkForm
          url="www.example.com"
          title=" Guide "
          onSave={(props) => saved.push(props)}
          onCancel={() => undefined}
        />,
      ),
    )
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    expect(saved).toEqual([{ url: 'https://www.example.com/', title: 'Guide' }])
    await act(async () =>
      root.render(
        <LinkForm
          key="invalid"
          url="javascript:alert(1)"
          onSave={(props) => saved.push(props)}
          onCancel={() => undefined}
        />,
      ),
    )
    expect(host.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(true)
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    expect(saved).toHaveLength(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    unbind()
  }
})
