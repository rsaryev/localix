import { documentBlocks, entryMetadata } from '../shared/document-blocks'
import { RichTextView } from '@localixai/kit/rich-text-view'
import { templates } from '../shared/templates'
import type { ResumeDocument } from '../shared/schema'

const styles = {
  awal: {
    root: 'font-sans space-y-6',
    name: 'text-2xl font-semibold',
    section: 'text-sm font-semibold',
  },
  ketat: {
    root: 'font-serif space-y-4',
    name: 'text-xl font-semibold',
    section: 'text-xs font-semibold border-b border-border pb-1',
  },
  luasa: {
    root: 'font-sans space-y-8',
    name: 'text-3xl font-medium',
    section: 'text-xs font-medium uppercase',
  },
  tebal: {
    root: 'font-sans space-y-6',
    name: 'text-3xl font-bold',
    section: 'text-sm font-bold uppercase border-b border-border pb-1',
  },
  klasik: {
    root: 'font-serif space-y-6',
    name: 'text-2xl font-semibold',
    section: 'text-xs font-semibold uppercase border-b border-border pb-1',
  },
  ketik: {
    root: 'font-mono space-y-6',
    name: 'text-xl font-bold',
    section: 'text-xs font-bold uppercase border-b border-dashed border-border pb-1',
  },
} as const

/** Reads the same filtered block stream as every export, without a second field mapping. */
export function Preview({ document }: { document: ResumeDocument }) {
  const style = styles[document.presentation.template]
  const blocks = documentBlocks(document)
  return (
    <article
      aria-label="Resume preview"
      className={`break-words p-6 text-sm text-document-ink ${style.root}`}
    >
      {blocks.map((block) => {
        if (block.kind === 'heading')
          return (
            <h2 key={block.id} className={style.section}>
              {block.title}
            </h2>
          )
        if (block.kind === 'header') {
          const h = block.header
          return (
            <header
              key={block.id}
              className={`space-y-2 ${templates[document.presentation.template].centered ? 'text-center' : ''}`}
            >
              <h1 className={style.name}>{h.name || 'Your name'}</h1>
              {h.headline && <p>{h.headline}</p>}
              {[h.email, h.phone, h.location].some(Boolean) && (
                <p className="text-xs text-document-ink/70">
                  {[h.email, h.phone, h.location].filter(Boolean).join(' · ')}
                </p>
              )}
              {h.links.length > 0 && (
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {h.links.map((link, index) => (
                    <span key={index}>
                      {link.label ? `${link.label}: ` : ''}
                      {link.url}
                    </span>
                  ))}
                </p>
              )}
            </header>
          )
        }
        const entry = block.entry
        const metadata = entryMetadata(entry)
        return (
          <section key={block.id} className="space-y-1.5">
            {(entry.title || entry.organization) && (
              <h3 className="font-semibold">
                {[entry.title, entry.organization].filter(Boolean).join(' — ')}
              </h3>
            )}
            {metadata && <p className="text-xs text-document-ink/70">{metadata}</p>}
            <RichTextView value={entry.body} />
            {entry.bullets.some((bullet) => bullet.trim()) && (
              <ul className="list-disc space-y-1 pl-5 leading-relaxed">
                {entry.bullets
                  .filter((bullet) => bullet.trim())
                  .map((bullet, index) => (
                    <li key={index} className="whitespace-pre-wrap">
                      {bullet}
                    </li>
                  ))}
              </ul>
            )}
            {entry.link && (
              <p className="text-xs">
                {entry.link.label ? `${entry.link.label}: ` : ''}
                {entry.link.url}
              </p>
            )}
          </section>
        )
      })}
      {blocks.length === 1 && (
        <p className="text-document-ink/70">
          Fill in your details and add a section to see your resume.
        </p>
      )}
    </article>
  )
}
