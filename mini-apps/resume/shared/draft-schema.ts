import { z } from 'zod'
import {
  documentSchema,
  entryFieldsSchema,
  headerSchema,
  linkSchema,
  sectionSchema,
} from './schema'

// Local drafts can contain temporarily invalid dates, empty achievements and unfinished URLs.
// Their shape and size are still checked before recovery; the server accepts only documentSchema.
const draftLink = linkSchema.extend({ url: z.string().max(2_000) })
const draftEntry = entryFieldsSchema.extend({
  start: z.string().max(7),
  end: z.string().max(7),
  bullets: z.array(z.string().max(2_000)).max(30),
  link: draftLink.nullable(),
})
export const draftSchema = z
  .strictObject({
    ...documentSchema.shape,
    title: z.string().max(500),
    header: headerSchema.extend({ links: z.array(draftLink).max(12) }),
    sections: z
      .array(
        z.strictObject({
          ...sectionSchema.shape,
          title: z.string().max(500),
          entries: z.array(draftEntry).max(60),
        }),
      )
      .max(24),
  })
  .refine((value) => JSON.stringify(value).length <= 400_000, 'Draft is too large')
