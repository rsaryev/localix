import { createElement, useEffect, useMemo, useState, type ElementType } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { AnswerVariant, AnswerVariants } from './AnswerVariants'
import { MarkdownBlockquote } from './MarkdownBlockquote'
import { FileTree } from './FileTree'
import { MarkdownDiagram } from './MarkdownDiagram'
import { childrenToText, getLanguage } from './markdownHelpers'
import { DIAGRAM_FENCE_LANGUAGE, TREE_FENCE_LANGUAGE } from './dialect'
import { escapeLiteralDollars } from './markdown-dollars'
import { hasHtmlSyntax, hasMathSyntax } from './syntax'
import { remarkHeadingIds, rehypeDocumentHeadingIds } from './headings'
import {
  loadMathPlugins,
  mathPluginsReady,
  rehypePluginsFor,
  remarkPluginsFor,
} from './markdownPlugins'

export type { Components } from 'react-markdown'
export { childrenToText, getLanguage, isCodeBlock } from './markdownHelpers'
export { MarkdownBlockquote } from './MarkdownBlockquote'
export { AnswerVariant, AnswerVariants } from './AnswerVariants'

const dialectComponents = {
  blockquote: MarkdownBlockquote,
  'answer-tabs': AnswerVariants,
  'answer-tab': AnswerVariant,
} as Components

export interface MarkdownProps {
  children: string
  components?: Components
  /** Set ids before the dialect transforms numbered headings. */
  headingIds?: boolean
}

/** Shared document renderer; hosts supply links, images, code chrome and typography. */
export function Markdown({ children, components, headingIds = false }: MarkdownProps) {
  const source = useMemo(() => escapeLiteralDollars(children), [children])
  const hasMath = hasMathSyntax(source)
  const [mathReady, setMathReady] = useState(mathPluginsReady)
  useEffect(() => {
    if (!hasMath || mathReady) return
    let current = true
    void loadMathPlugins().then(
      () => {
        if (current) setMathReady(true)
      },
      () => {
        /* Keep readable source; a new document can retry a failed chunk. */
      },
    )
    return () => {
      current = false
    }
  }, [hasMath, mathReady, children])

  const mathActive = hasMath && mathReady
  const remarkPlugins = useMemo(
    () => [...(headingIds ? [remarkHeadingIds] : []), ...remarkPluginsFor(mathActive)],
    [headingIds, mathActive],
  )
  const htmlActive = hasHtmlSyntax(source)
  const rehypePlugins = useMemo(
    () =>
      rehypePluginsFor(
        htmlActive,
        mathActive,
        htmlActive && headingIds ? rehypeDocumentHeadingIds(source) : undefined,
      ),
    [htmlActive, mathActive, headingIds, source],
  )
  const renderers = useMemo(() => {
    const code: Components['code'] = (props) => {
      const language = getLanguage(props.className)
      const text = childrenToText(props.children).replace(/\n$/, '')
      if (language === DIAGRAM_FENCE_LANGUAGE) return <MarkdownDiagram source={text} />
      if (language === TREE_FENCE_LANGUAGE) return <FileTree source={text} />
      const Code = components?.code
      return Code ? (
        createElement(Code as ElementType, props)
      ) : (
        <code className={props.className}>{props.children}</code>
      )
    }
    const pre: Components['pre'] = (props) => {
      // Special fences produce block elements; preserve valid HTML instead of nesting in <pre>.
      const child = props.node?.children[0]
      const classes = child?.type === 'element' ? child.properties.className : undefined
      if (
        Array.isArray(classes) &&
        classes.some(
          (name) =>
            name === `language-${DIAGRAM_FENCE_LANGUAGE}` ||
            name === `language-${TREE_FENCE_LANGUAGE}`,
        )
      )
        return <>{props.children}</>
      const Pre = components?.pre
      return Pre ? createElement(Pre as ElementType, props) : <pre>{props.children}</pre>
    }
    return { ...dialectComponents, ...components, code, pre }
  }, [components])

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={renderers}
    >
      {source}
    </ReactMarkdown>
  )
}
