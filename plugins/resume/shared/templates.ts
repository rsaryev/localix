import { emptyDocument, emptyEntry, type ResumeDocument } from './schema'
import { sectionDefinitions } from './sections'

export const templateIds = ['awal', 'ketat', 'luasa', 'tebal', 'klasik', 'ketik'] as const
export type TemplateId = (typeof templateIds)[number]
export interface ResumeTemplate {
  id: TemplateId
  name: string
  description: string
  font: 'sans' | 'serif' | 'mono'
  centered: boolean
  nameSize: number
  bodySize: number
  headingSize: number
  lineHeight: number
  sectionGap: number
  heading: 'plain' | 'rule' | 'dashed'
  uppercase: boolean
}
// Original implementations of the six reference template directions, sharing one block model.
export const templates: Record<TemplateId, ResumeTemplate> = {
  awal: {
    id: 'awal',
    name: 'Awal',
    description: 'Clear single-column foundation',
    font: 'sans',
    centered: false,
    nameSize: 24,
    bodySize: 10,
    headingSize: 12,
    lineHeight: 1.4,
    sectionGap: 18,
    heading: 'plain',
    uppercase: false,
  },
  ketat: {
    id: 'ketat',
    name: 'Ketat',
    description: 'Compact serif with ruled sections',
    font: 'serif',
    centered: false,
    nameSize: 22,
    bodySize: 9,
    headingSize: 10,
    lineHeight: 1.4,
    sectionGap: 14,
    heading: 'rule',
    uppercase: false,
  },
  luasa: {
    id: 'luasa',
    name: 'Luasa',
    description: 'Quiet headings and generous space',
    font: 'sans',
    centered: false,
    nameSize: 26,
    bodySize: 10,
    headingSize: 10,
    lineHeight: 1.45,
    sectionGap: 24,
    heading: 'plain',
    uppercase: true,
  },
  tebal: {
    id: 'tebal',
    name: 'Tebal',
    description: 'Strong name and bold section hierarchy',
    font: 'sans',
    centered: false,
    nameSize: 32,
    bodySize: 10,
    headingSize: 12,
    lineHeight: 1.4,
    sectionGap: 18,
    heading: 'rule',
    uppercase: true,
  },
  klasik: {
    id: 'klasik',
    name: 'Klasik',
    description: 'Traditional serif with a centered header',
    font: 'serif',
    centered: true,
    nameSize: 24,
    bodySize: 10,
    headingSize: 11,
    lineHeight: 1.45,
    sectionGap: 20,
    heading: 'rule',
    uppercase: true,
  },
  ketik: {
    id: 'ketik',
    name: 'Ketik',
    description: 'Monospaced document with dashed headings',
    font: 'mono',
    centered: false,
    nameSize: 22,
    bodySize: 9,
    headingSize: 10,
    lineHeight: 1.4,
    sectionGap: 18,
    heading: 'dashed',
    uppercase: true,
  },
}
export function createTemplateDocument(template: TemplateId, title: string): ResumeDocument {
  return {
    ...emptyDocument(title),
    presentation: { template },
    sections: ['summary', 'experience', 'education', 'projects', 'skills'].map((type) => {
      const sectionType = type as keyof typeof sectionDefinitions
      return {
        id: crypto.randomUUID(),
        type: sectionType,
        title: sectionDefinitions[sectionType].title,
        hidden: false,
        entries: sectionType === 'summary' ? [emptyEntry()] : [],
      }
    }),
  }
}
