import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { completionOptionId } from './CompletionMenu'
import { TextArea } from './TextArea'

describe('composer completion accessibility', () => {
  test('keeps textarea focus while pointing assistive tech at the active option', () => {
    const menuId = 'test-completion-menu'
    const activeOptionId = completionOptionId(menuId, 2)
    const html = renderToStaticMarkup(
      <TextArea
        value="@resource"
        onChange={() => {}}
        onFocus={() => {}}
        onBlur={() => {}}
        onSubmit={() => {}}
        placeholder="Message"
        disabled={false}
        completion={{ open: true, menuId, activeOptionId }}
      />,
    )

    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-autocomplete="list"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain(`aria-controls="${menuId}"`)
    expect(html).toContain(`aria-activedescendant="${activeOptionId}"`)
  })
})
