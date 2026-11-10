import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { DocMarkdown } from './DocMarkdown'
import { makeMdComponents } from './markdownComponents'
import { extractDocHeadings } from './extractDocHeadings'
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
    onHeadings(extractDocHeadings(content))
  }, [content, onHeadings])
  return <DocMarkdown components={components}>{content}</DocMarkdown>
}
