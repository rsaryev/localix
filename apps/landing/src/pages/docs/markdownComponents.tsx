import { useState } from 'react'
import { highlightCode } from '@localixai/markdown/highlight'
import { childrenToText, type Components } from '@localixai/markdown/react'
import { screenshotAssets } from '../../generated/shots'
import { Screenshot } from '../../components/Screenshot'
import { DocCodeBlock } from './DocCodeBlock'
import { pathToSlug, resolveRepoPath } from './docLinks'

const SCREENSHOT_ASSETS = screenshotAssets as Readonly<
  Record<string, { src: string; capturedAt: string }>
>

/**
 * A doc image that removes itself if the file is not there.
 *
 * Screenshot slots are declared in the markdown before the capture exists, so the
 * page can be written ahead of the photograph. Rendering the browser's broken-image
 * icon for those would be worse than showing nothing: it reads as a site defect
 * rather than as a shot that has not been taken. The prose is written to stand on
 * its own, so omitting the figure loses nothing.
 */
function DocImage({ src, alt, capture = false }: { src: string; alt: string; capture?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const image = (
    <img
      src={src}
      alt={alt}
      width={capture ? 1600 : undefined}
      height={capture ? 1000 : undefined}
      loading="lazy"
      className={capture ? 'screenshot-thumbnail' : undefined}
      onError={() => setFailed(true)}
    />
  )
  return capture ? (
    <Screenshot src={src} alt={alt} title={alt}>
      {image}
    </Screenshot>
  ) : (
    image
  )
}

export function makeMdComponents(sourcePath: string, navigate: (to: string) => void) {
  return {
    h1: ({ children, id }) => (
      <h1 id={id} tabIndex={-1}>
        {children}
      </h1>
    ),
    h2: ({ children, id }) => (
      <h2 id={id} tabIndex={-1}>
        {children}
      </h2>
    ),
    h3: ({ children, id }) => (
      <h3 id={id} tabIndex={-1}>
        {children}
      </h3>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      if (!src) return null
      if (/^(https?:|data:)/.test(src)) return <DocImage src={src} alt={alt ?? ''} />
      const repoPath = resolveRepoPath(src, sourcePath)
      const asset = SCREENSHOT_ASSETS[repoPath]
      if (!asset) return null
      return <DocImage src={asset.src} alt={alt ?? ''} capture />
    },
    pre: ({ children }: { children?: React.ReactNode }) => <DocCodeBlock>{children}</DocCodeBlock>,
    table: ({ children, ...props }) => (
      <div className="docs-table-scroll">
        <table style={{ textAlign: props.style?.textAlign }}>{children}</table>
      </div>
    ),
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      const text = childrenToText(children)
      const isBlock = /language-/.test(className ?? '') || text.includes('\n')
      if (!isBlock) return <code>{children}</code>
      return (
        <code
          className={className}
          dangerouslySetInnerHTML={{
            __html: highlightCode(
              text.replace(/\n$/, ''),
              className?.match(/language-([A-Za-z0-9_-]+)/)?.[1],
            ),
          }}
        />
      )
    },
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      // A markdown link with no destination is not a link. Rendering a bare `<a>` produced an
      // element that is announced as one and goes nowhere; the text is the whole content.
      if (!href) return <>{children}</>
      // in-page anchor
      if (href.startsWith('#')) {
        return <a href={href}>{children}</a>
      }
      // external / mailto
      if (/^(https?:|mailto:)/.test(href)) {
        const ext = href.startsWith('http')
        return (
          <a href={href} target={ext ? '_blank' : undefined} rel={ext ? 'noreferrer' : undefined}>
            {children}
          </a>
        )
      }
      // Relative links to public docs keep client-side navigation. Any other
      // relative link remains an ordinary link instead of becoming inert text.
      const repoPath = resolveRepoPath(href, sourcePath)
      const docSlug = pathToSlug(repoPath)
      if (docSlug) {
        const hash = href.includes('#') ? `#${href.split('#')[1]}` : ''
        const destination = `/docs/${docSlug}${hash}`
        return (
          <a
            href={destination}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              navigate(destination)
            }}
          >
            {children}
          </a>
        )
      }
      return <a href={href}>{children}</a>
    },
  } satisfies Components
}
