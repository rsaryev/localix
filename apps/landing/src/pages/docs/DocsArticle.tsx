import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { Markdown } from '@localixai/markdown/react'
import { extractMarkdownHeadings } from '@localixai/markdown'
import { makeMdComponents } from './markdownComponents'
import type { DocHeading } from './docBootstrap'

export function DocsArticle({
  content,
  sourcePath,
  onHeadings,
}: {
  content: string
  sourcePath: string
  onHeadings: (headings: DocHeading[]) => void
}) {
  const navigate = useNavigate()
  const components = useMemo(
    () => makeMdComponents(sourcePath, (to) => void navigate(to)),
    [sourcePath, navigate],
  )
  useEffect(() => {
    onHeadings(
      extractMarkdownHeadings(content).filter(
        (heading): heading is DocHeading => heading.depth === 2 || heading.depth === 3,
      ),
    )
  }, [content, onHeadings])
  return (
    <Markdown headingIds components={components}>
      {content}
    </Markdown>
  )
}
