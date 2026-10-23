import { useEffect } from 'react'
import { Mail, Phone, MapPin, Link } from 'lucide-react'
import type { DocumentParagraph } from '@localixai/mini-app-sdk/document-layout'
import type { ResumeDocument } from '../shared/schema'
import { resumeLayout } from '../shared/layout'
import { ensureDocumentFont } from './documentFonts'
const icons = { email: Mail, phone: Phone, location: MapPin, link: Link }
function Paragraph({ p }: { p: DocumentParagraph }) {
  const Icon = p.icon ? icons[p.icon] : null
  return (
    <p
      className="whitespace-pre-wrap break-words"
      style={{
        fontFamily: `LocalixDocument-${p.font}, LocalixDocument-inter`,
        fontSize: `${p.size}pt`,
        lineHeight: p.lineHeight,
        letterSpacing: `${p.tracking}pt`,
        textAlign: p.align,
        marginTop: `${p.before}pt`,
        marginBottom: `${p.after}pt`,
        paddingLeft: `${p.indent}pt`,
      }}
    >
      {Icon && <Icon className="mr-1 inline-block size-3 align-middle" />}
      {p.runs.map((run, index) => (
        <span
          key={index}
          style={{
            fontWeight: run.bold ? 700 : 400,
            fontStyle: run.italic ? 'italic' : 'normal',
            ...(run.href ? { textDecoration: 'underline' } : {}),
          }}
        >
          {run.text}
        </span>
      ))}
    </p>
  )
}
/** Thumbnail/fallback rendering uses the export's projection and the exact same font files. */
export function Preview({ document }: { document: ResumeDocument }) {
  const layout = resumeLayout(document)
  const fonts = [
    ...new Set([
      'inter',
      ...layout.blocks.flatMap((block) =>
        block.kind === 'paragraph'
          ? [block.font]
          : block.kind === 'columns'
            ? block.columns.flat().map((p) => p.font)
            : block.kind === 'header'
              ? [...block.left, ...block.right].map((p) => p.font)
              : [],
      ),
    ]),
  ].join(',')
  useEffect(() => {
    fonts
      .split(',')
      .filter(Boolean)
      .forEach((font) => {
        void ensureDocumentFont(font as DocumentParagraph['font']).catch(() => {})
      })
  }, [fonts])
  return (
    <article
      aria-label="Resume preview"
      className="break-words text-document-ink"
      style={{ padding: `${layout.margin}pt` }}
    >
      {layout.blocks.map((block, index) => {
        if (block.kind === 'paragraph') return <Paragraph key={index} p={block} />
        if (block.kind === 'rule')
          return (
            <div
              key={index}
              className="border-document-ink/60"
              style={{
                borderBottomWidth: `${block.width}pt`,
                borderBottomStyle: block.dashed ? 'dashed' : 'solid',
                marginBottom: '4pt',
              }}
            />
          )
        if (block.kind === 'columns') {
          const count = Math.max(...block.columns.map((column) => column.length))
          return (
            <div
              key={index}
              className="grid gap-x-4"
              style={{ gridTemplateColumns: `repeat(${block.columns.length}, minmax(0,1fr))` }}
            >
              {Array.from({ length: count }, (_, row) =>
                block.columns.map((column, col) => (
                  <div key={`${row}-${col}`}>{column[row] && <Paragraph p={column[row]} />}</div>
                )),
              )}
            </div>
          )
        }
        if (block.kind === 'portrait')
          return (
            <img
              key={index}
              src={block.data}
              alt="Resume portrait"
              style={{
                width: `${block.size}pt`,
                height: `${block.size}pt`,
                borderRadius: `${block.radius}%`,
              }}
            />
          )
        const photo = block.photo
        return (
          <header
            key={index}
            className="flex gap-3"
            style={{
              flexDirection: block.centered ? 'column' : 'row',
              alignItems: block.centered ? 'center' : 'stretch',
            }}
          >
            {photo && (
              <img
                src={photo.data}
                alt="Resume portrait"
                className="shrink-0 object-cover"
                style={{
                  width: `${photo.size}pt`,
                  height: `${photo.size}pt`,
                  borderRadius: `${photo.radius}%`,
                  alignSelf:
                    block.centered || photo.align === 'center'
                      ? 'center'
                      : photo.align === 'bottom'
                        ? 'flex-end'
                        : 'flex-start',
                }}
              />
            )}
            <div className="min-w-0 flex-1">
              {block.left.map((p, i) => (
                <Paragraph key={i} p={p} />
              ))}
            </div>
            {block.right.length > 0 && (
              <div className="min-w-0 w-2/5">
                {block.right.map((p, i) => (
                  <Paragraph key={i} p={p} />
                ))}
              </div>
            )}
          </header>
        )
      })}
    </article>
  )
}
