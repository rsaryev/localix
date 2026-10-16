import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PinnedSkillsRow } from './PinnedSkillsRow'

describe('PinnedSkillsRow', () => {
  it('uses a consistent close icon for removable skill tokens', () => {
    const html = renderToStaticMarkup(
      <PinnedSkillsRow skills={['sample-skill']} onChange={() => {}} />,
    )

    expect(html).toContain('/sample-skill')
    expect(html).toContain('lucide-x')
    expect(html).toContain('aria-label="Remove /sample-skill"')
    expect(html).not.toContain('>×<')
  })
})
