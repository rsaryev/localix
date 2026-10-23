import type { DocumentFont } from '@localixai/mini-app-sdk/document-layout'
import type { ResumeDocument } from './schema'
import type { TemplateId } from './templates'

/** Original render directions; physical values independent of workbench text preferences. */
const directions: Record<
  TemplateId,
  {
    font: DocumentFont
    accent: DocumentFont
    name: number
    heading: number
    gap: number
    uppercase: boolean
    rule: 'none' | 'top' | 'bottom' | 'double' | 'dashed'
    centered: boolean
    margin: number
  }
> = {
  awal: {
    font: 'inter',
    accent: 'inter',
    name: 18,
    heading: 10,
    gap: 18,
    uppercase: true,
    rule: 'bottom',
    centered: false,
    margin: 44,
  },
  ketat: {
    font: 'inter',
    accent: 'lora',
    name: 19,
    heading: 11.5,
    gap: 14,
    uppercase: false,
    rule: 'double',
    centered: false,
    margin: 44,
  },
  luasa: {
    font: 'inter',
    accent: 'lora',
    name: 18,
    heading: 9.5,
    gap: 24,
    uppercase: true,
    rule: 'none',
    centered: false,
    margin: 48,
  },
  tebal: {
    font: 'inter',
    accent: 'inter',
    name: 22,
    heading: 10,
    gap: 18,
    uppercase: true,
    rule: 'top',
    centered: false,
    margin: 44,
  },
  klasik: {
    font: 'lora',
    accent: 'lora',
    name: 20,
    heading: 10,
    gap: 20,
    uppercase: true,
    rule: 'bottom',
    centered: true,
    margin: 48,
  },
  ketik: {
    font: 'inter',
    accent: 'geist-mono',
    name: 16,
    heading: 9.5,
    gap: 18,
    uppercase: true,
    rule: 'dashed',
    centered: false,
    margin: 44,
  },
}
export function presentationFor(document: ResumeDocument) {
  const p = document.presentation
  const direction = directions[p.template]
  return {
    ...direction,
    font: p.font ?? direction.font,
    accent: p.font ?? direction.accent,
    name: direction.name * (p.nameScale ?? 1),
    heading: direction.heading * (p.titleScale ?? 1),
    body: 9 * (p.bodyScale ?? 1),
    gap: Math.max(0, direction.gap + (p.sectionSpacing ?? 0)),
    tracking: p.letterSpacing ?? 0,
    lineHeight: p.lineHeight ?? (['luasa', 'klasik'].includes(p.template) ? 1.45 : 1.4),
    photoSize: (p.photoSize ?? 56) * 0.75,
    photoRadius: p.photoRadius ?? 0,
  }
}
export const sectionLabels = {
  en: {
    summary: 'Summary',
    experience: 'Experience',
    internship: 'Internships',
    projects: 'Projects',
    organizations: 'Organizations',
    education: 'Education',
    certifications: 'Certifications',
    skills: 'Skills',
    languages: 'Languages',
    custom: 'Additional information',
  },
  id: {
    summary: 'Ringkasan',
    experience: 'Pengalaman',
    internship: 'Magang',
    projects: 'Proyek',
    organizations: 'Organisasi',
    education: 'Pendidikan',
    certifications: 'Sertifikasi',
    skills: 'Keahlian',
    languages: 'Bahasa',
    custom: 'Informasi tambahan',
  },
} as const
