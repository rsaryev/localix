import { z } from 'zod'

/** Portable, bounded document presentation port shared by exporters and Documents. Units are pt. */
export const documentFonts = {
  inter: 'Inter',
  carlito: 'Carlito',
  arimo: 'Arimo',
  roboto: 'Roboto',
  'open-sans': 'Open Sans',
  'source-sans-3': 'Source Sans 3',
  lora: 'Lora',
  tinos: 'Tinos',
  'eb-garamond': 'EB Garamond',
  'source-serif-4': 'Source Serif 4',
  merriweather: 'Merriweather',
  'geist-mono': 'Geist Mono',
  'jetbrains-mono': 'JetBrains Mono',
  'courier-prime': 'Courier Prime',
  'ibm-plex-mono': 'IBM Plex Mono',
} as const
export const documentFontIds = Object.keys(documentFonts) as Array<keyof typeof documentFonts>
export const documentFontSchema = z.enum(documentFontIds)
export type DocumentFont = z.infer<typeof documentFontSchema>
export const portraitSchema = z
  .string()
  .max(300_000)
  .regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/u)
const href = z
  .string()
  .max(2_000)
  .refine((value) => /^(https?:|mailto:|tel:)/u.test(value))
export const documentRunSchema = z.strictObject({
  text: z.string().max(16_000),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: href.optional(),
  font: documentFontSchema.optional(),
})
export const documentParagraphSchema = z.strictObject({
  kind: z.literal('paragraph'),
  runs: z.array(documentRunSchema).max(1_000),
  size: z.number().min(6).max(48),
  font: documentFontSchema,
  align: z.enum(['left', 'center', 'right']).default('left'),
  before: z.number().min(0).max(80).default(0),
  after: z.number().min(0).max(80).default(0),
  indent: z.number().min(0).max(80).default(0),
  lineHeight: z.number().min(1.2).max(2).default(1.4),
  tracking: z.number().min(-0.5).max(0.5).default(0),
  muted: z.boolean().optional(),
  keepWithNext: z.boolean().optional(),
  icon: z.enum(['email', 'phone', 'location', 'link']).optional(),
})
export const documentLayoutSchema = z
  .strictObject({
    title: z.string().max(500),
    margin: z.number().min(20).max(72).default(40),
    blocks: z
      .array(
        z.discriminatedUnion('kind', [
          documentParagraphSchema,
          z.strictObject({
            kind: z.literal('header'),
            left: z.array(documentParagraphSchema).max(20),
            right: z.array(documentParagraphSchema).max(20),
            centered: z.boolean(),
            photo: z
              .strictObject({
                data: portraitSchema,
                size: z.number().min(30).max(72),
                radius: z.number().min(0).max(50),
                align: z.enum(['top', 'center', 'bottom']),
              })
              .optional(),
          }),
          z.strictObject({
            kind: z.literal('rule'),
            width: z.number().min(0.25).max(3),
            dashed: z.boolean().optional(),
          }),
          z.strictObject({
            kind: z.literal('columns'),
            columns: z.array(z.array(documentParagraphSchema).max(100)).min(1).max(2),
          }),
          z.strictObject({
            kind: z.literal('portrait'),
            data: portraitSchema,
            size: z.number().min(30).max(72),
            radius: z.number().min(0).max(50),
            align: z.enum(['left', 'center', 'right']),
          }),
        ]),
      )
      .max(3_000),
    pageNumbers: z.boolean().default(true),
  })
  .refine((value) => {
    try {
      return JSON.stringify(value).length <= 1_000_000
    } catch {
      return false
    }
  }, 'Document layout exceeds 1,000,000 characters')
export type DocumentLayout = z.infer<typeof documentLayoutSchema>
export type DocumentParagraph = z.infer<typeof documentParagraphSchema>
export type DocumentRun = z.infer<typeof documentRunSchema>
