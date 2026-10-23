import type { ResumeEntry, SectionType } from './schema'

export type EntryField = Exclude<
  keyof ResumeEntry,
  'id' | 'current' | 'link' | 'context' | 'proficiency'
>
type SectionDefinition = {
  title: string
  fields: readonly EntryField[]
  titleLabel?: string
  organizationLabel?: string
}
const career = ['title', 'organization', 'location', 'start', 'end', 'body', 'bullets'] as const
export const sectionDefinitions: Record<SectionType, SectionDefinition> = {
  summary: { title: 'Summary', fields: ['body'] },
  experience: {
    title: 'Experience',
    fields: career,
    titleLabel: 'Role',
    organizationLabel: 'Company',
  },
  internship: {
    title: 'Internships',
    fields: career,
    titleLabel: 'Role',
    organizationLabel: 'Company',
  },
  projects: {
    title: 'Projects',
    fields: ['title', 'organization', 'start', 'end', 'body', 'bullets'],
  },
  organizations: { title: 'Organizations', fields: career, titleLabel: 'Role' },
  education: {
    title: 'Education',
    fields: career,
    titleLabel: 'Degree or qualification',
    organizationLabel: 'School',
  },
  certifications: {
    title: 'Certifications',
    fields: ['title', 'organization', 'start', 'end', 'body'],
  },
  skills: { title: 'Skills', fields: ['title', 'body'], titleLabel: 'Group' },
  languages: { title: 'Languages', fields: ['title', 'body'], titleLabel: 'Language' },
  custom: { title: 'Additional information', fields: career },
}
