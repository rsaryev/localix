import { z } from 'zod'
import type { ElementTypeSpec } from '../registry/contract'
import { PASTED_DIR } from '../resource'

/**
 * The types that POINT at something outside the board: a file, a folder, an image, a document, a
 * web page. They hold a reference, never a copy — a file of the project stays the file the editor
 * opens, and the card shows what it holds now. A path is project-relative with `/` separators when
 * the file is in the project, absolute otherwise (a file dropped from elsewhere on the disk).
 */
const pathSchema = z.string().trim().min(1)

const baseName = (path: string) => path.replace(/\/+$/u, '').split('/').pop() || path

const fileProps = z.object({
  path: pathSchema,
  /** A line to open the file at, for a reference to one place in it. */
  line: z.number().int().positive().optional(),
})

export const fileType: ElementTypeSpec<z.infer<typeof fileProps>> = {
  type: 'file',
  version: 1,
  label: 'File',
  description:
    'A live reference to a file: the card previews it and opens it in the editor. props: path (project-relative), line.',
  props: fileProps,
  size: { w: 320, h: 200 },
  minSize: { w: 160, h: 56 },
  text: (props) => props.path,
  claims: { rank: -1, fromPath: (path) => ({ path }) },
}

const folderProps = z.object({ path: pathSchema })

export const folderType: ElementTypeSpec<z.infer<typeof folderProps>> = {
  type: 'folder',
  version: 1,
  label: 'Folder',
  description: 'A live reference to a folder: the card lists what is in it. props: path.',
  props: folderProps,
  size: { w: 280, h: 240 },
  minSize: { w: 160, h: 56 },
  text: (props) => `${baseName(props.path)}/`,
  claims: { folder: true, fromPath: (path) => ({ path }) },
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']

/**
 * `contain` shows the whole picture and the element takes its proportions; `cover` fills
 * whatever box it is given and crops the overflow — a picture used as the background of an area.
 */
export const IMAGE_FITS = ['contain', 'cover'] as const
export type ImageFit = (typeof IMAGE_FITS)[number]

const imageProps = z
  .object({
    path: pathSchema.optional(),
    url: z
      .url()
      .refine((url) => /^https?:\/\//iu.test(url), 'Use an HTTP or HTTPS image URL')
      .optional(),
    alt: z.string().default(''),
    fit: z.enum(IMAGE_FITS).default('contain'),
    /** Reproducible source of a chat visualization; its SVG is a snapshot, not editable board nodes. */
    source: z
      .string()
      .max(64 * 1024)
      .optional(),
    sourceFormat: z.string().max(40).optional(),
  })
  .refine((props) => Boolean(props.path) !== Boolean(props.url), 'Use either an image path or URL')

export const imageType: ElementTypeSpec<z.infer<typeof imageProps>> = {
  type: 'image',
  version: 1,
  label: 'Image',
  description: `An image shown on the board. props: path OR url (HTTP/HTTPS reference), alt, fit (contain: whole picture; cover: crops to fill). Pasted and generated Localix images are saved under ${PASTED_DIR}/. Remote images remain URL references.`,
  props: imageProps,
  size: { w: 360, h: 240 },
  minSize: { w: 48, h: 48 },
  text: (props) => props.alt || baseName(props.path ?? props.url ?? ''),
  claims: { extensions: IMAGE_EXTENSIONS, fromPath: (path) => ({ path }) },
}

export const DOCUMENT_EXTENSIONS = [
  'pdf',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
  'odt',
  'rtf',
]

const documentProps = z.object({ path: pathSchema })

export const documentType: ElementTypeSpec<z.infer<typeof documentProps>> = {
  type: 'document',
  version: 1,
  label: 'Document',
  description:
    'A PDF, Word, Excel or PowerPoint file: the card shows its text; opening it uses the app viewer. props: path.',
  props: documentProps,
  size: { w: 300, h: 360 },
  minSize: { w: 160, h: 56 },
  text: (props) => baseName(props.path),
  claims: { extensions: DOCUMENT_EXTENSIONS, fromPath: (path) => ({ path }) },
}

const linkProps = z.object({
  url: z.url(),
  title: z.string().default(''),
})

export const linkType: ElementTypeSpec<z.infer<typeof linkProps>> = {
  type: 'link',
  version: 1,
  label: 'Link',
  description: 'A web link card that opens the page. props: url, title.',
  props: linkProps,
  size: { w: 300, h: 76 },
  minSize: { w: 140, h: 48 },
  textProp: 'title',
  text: (props) => props.title || props.url,
  claims: { url: true, fromUrl: (url) => ({ url }) },
}

export { baseName }
