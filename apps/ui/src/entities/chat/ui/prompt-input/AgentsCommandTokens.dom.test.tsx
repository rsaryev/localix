import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ComposerCommands } from './useComposerCommands'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('agent flag completions and crumbs round-trip the submitted prompt with keyboard editing', async () => {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useComposerCommands } = await import('./useComposerCommands')
  const { CommandChipPrefix } = await import('./CommandChipPrefix')
  const { SlashArgMenu } = await import('./SlashArgMenu')
  const { Autocomplete, AutocompleteAnchor } = await import('@localixai/kit/autocomplete')
  let current: ComposerCommands
  let prompt = ''
  function Harness() {
    const [value, setValue] = useState('/agents edit @qa --pri')
    prompt = value
    current = useComposerCommands(value, setValue)
    return (
      <Autocomplete open={current.slashArgs.isMenuOpen}>
        <AutocompleteAnchor asChild>
          <div>
            <CommandChipPrefix slash={current.slash} slashArgs={current.slashArgs} />
          </div>
        </AutocompleteAnchor>
        <SlashArgMenu
          options={current.slashArgs.options}
          activeIndex={current.slashArgs.activeIndex}
          onSelect={current.slashArgs.selectOption}
          onHover={current.slashArgs.setActiveIndex}
        />
      </Autocomplete>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const key = (name: string) => current.handleKeyDown({ key: name, preventDefault() {} } as never)
  try {
    await act(async () => root.render(<Harness />))
    expect(document.body.querySelector('[role="listbox"]')?.textContent).toContain('--priority')
    await act(async () => {
      expect(key('Tab')).toBe(true)
    })
    expect(prompt).toBe('/agents edit @qa --priority ')
    expect(current!.slashArgs.activeSpec?.name).toBe('priority')
    expect(current!.slashArgs.options.map((row) => row.value)).toEqual(['-2', '-1', '0', '1', '2'])
    await act(async () => current!.onTextChange('0.5 '))
    expect(prompt).toBe('/agents edit @qa --priority 0.5 ')
    expect(host.querySelector('[title="priority: 0.5"]')?.textContent).toContain('0.5')
    expect(host.querySelector('[title="agent: @qa"]')).not.toBeNull()
    // Optional remaining flags are suggestions; Enter can submit the complete raw command.
    expect(key('Enter')).toBe(false)
    await act(async () => current!.slashArgs.clearArgFrom(3))
    expect(prompt).toBe('/agents edit @qa --priority ')
    await act(async () => current!.onTextChange('0 '))
    await act(async () => current!.onTextChange('--instructions "Check:\n- schema\n- retries" '))
    expect(prompt).toBe(
      '/agents edit @qa --priority 0 --instructions "Check:\n- schema\n- retries" ',
    )
    // The typed value stays editable: Space does not open a menu and Enter submits.
    expect(current!.textValue).toBe('"Check:\n- schema\n- retries" ')
    expect(current!.slashArgs.isMenuOpen).toBe(false)
    expect(current!.slashArgs.valueHint?.empty).toBe(false)
    expect(key('Enter')).toBe(false)
    expect(key('ArrowDown')).toBe(false)
    await act(async () => current!.onTextChange('"Check:\n- schema\n- retries" --h'))
    expect(current!.slashArgs.chips.at(-1)?.option.value).toBe('"Check:\n- schema\n- retries"')
    expect(host.querySelector('[title="instructions: Check:\n- schema\n- retries"]')).not.toBeNull()
    await act(async () => {
      expect(key('Tab')).toBe(true)
    })
    expect(prompt).toContain('--handle ')
    expect(current!.slashArgs.valueHint?.flag).toBe('--handle')
    await act(async () => current!.onTextChange('qa-two --description '))
    expect(current!.slashArgs.valueHint).toEqual({
      flag: '--description',
      description: 'One-line specialization',
      empty: true,
    })
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    const submitted = prompt
    expect(key('Enter')).toBe(true)
    expect(prompt).toBe(submitted)
    await act(async () => current!.onTextChange('Reviews SQL '))
    expect(current!.textValue).toBe('Reviews SQL ')
    expect(current!.slashArgs.valueHint?.empty).toBe(false)
    expect(key('Enter')).toBe(false)
    expect(prompt).toContain('--description Reviews SQL ')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
