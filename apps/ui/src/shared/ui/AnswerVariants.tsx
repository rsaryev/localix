import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { TabBar, TabPanel, useTabPanelIds } from '@localixai/kit/tabs'

type AnswerVariantProps = { children?: ReactNode; node?: unknown; 'data-label'?: string }

/**
 * One variant of a `> [!TABS]` block (`remarkAnswerContainers.ts`). Its label rides as a data
 * attribute; the panel itself is drawn by `AnswerVariants`, so on its own this is just its content.
 */
export function AnswerVariant({ children }: AnswerVariantProps) {
  return <>{children}</>
}

/**
 * `> [!TABS]`: the variants of one answer — an install per OS, an example per language — of
 * which the reader needs ONE. Drawn as tabs so the other variants stop pushing theirs down the
 * reply. The first is shown; every panel stays in the DOM (`hidden`), so a search on the page,
 * a copy of the whole message and a screen reader's panel navigation all still reach them.
 */
export function AnswerVariants({ children }: { children?: ReactNode; node?: unknown }) {
  const tabs = Children.toArray(children).filter(
    (child): child is ReactElement<AnswerVariantProps> => isValidElement(child),
  )
  const ids = useTabPanelIds('answer-tabs')
  const [active, setActive] = useState('0')
  if (tabs.length === 0) return null
  const items = tabs.map((tab, index) => ({
    id: String(index),
    label: tab.props['data-label'] || String(index + 1),
    ...ids.item(String(index)),
  }))
  // A streamed block can lose a tab between renders only by being re-parsed; never point past it.
  const current = Number(active) < tabs.length ? active : '0'
  return (
    <div className="lx-tabs">
      <TabBar
        items={items}
        active={current}
        onChange={setActive}
        aria-label="Variants"
        className="nodrag"
      />
      {tabs.map((tab, index) => (
        <TabPanel
          key={index}
          active={String(index) === current}
          id={ids.panelId(String(index))}
          aria-labelledby={ids.tabId(String(index))}
          className="lx-tab-panel"
        >
          {tab.props.children}
        </TabPanel>
      ))}
    </div>
  )
}
