import { createTemplateDocument, type TemplateId } from './templates'
import { emptyEntry, type ResumeDocument } from './schema'

/** Clearly fictional starter content; never used by agent initialization by default. */
export function createSampleDocument(template: TemplateId, title: string): ResumeDocument {
  const document = createTemplateDocument(template, title)
  document.header = {
    name: 'Sample Candidate',
    headline: 'Software Engineer',
    email: 'candidate@example.com',
    phone: '+1 555 010 0123',
    location: 'San Francisco, CA',
    links: [{ label: 'Portfolio', url: 'https://example.com' }],
  }
  const entries = {
    summary: [
      {
        ...emptyEntry(),
        body: 'Illustrative profile. Replace this sample with your own experience, strengths and career goals before sharing your resume.',
      },
    ],
    experience: [
      {
        ...emptyEntry(),
        title: 'Software Engineer',
        organization: 'Example Company',
        location: 'San Francisco, CA',
        start: '2022-03',
        current: true,
        body: 'Sample role describing the product and your responsibilities.',
        bullets: [
          'Describe a project you delivered and the problem it solved.',
          'Explain the outcome using measurements you can substantiate.',
          'Show how you collaborated with your team.',
        ],
      },
      {
        ...emptyEntry(),
        title: 'Junior Software Engineer',
        organization: 'Example Studio',
        start: '2020-06',
        end: '2022-02',
        bullets: [
          'Replace this line with a real achievement.',
          'Add relevant tools and responsibilities.',
        ],
      },
    ],
    education: [
      {
        ...emptyEntry(),
        title: 'Degree or qualification',
        organization: 'Example University',
        start: '2016',
        end: '2020',
        body: 'Replace with your actual qualification and institution.',
      },
    ],
    projects: [
      {
        ...emptyEntry(),
        title: 'Example project',
        organization: 'Creator and maintainer',
        body: 'Describe the project, your contribution and a verifiable outcome.',
        link: { label: 'Project', url: 'https://example.com/project' },
      },
    ],
    skills: [
      {
        ...emptyEntry(),
        title: 'Technical skills',
        body: 'Replace with skills you can demonstrate.',
      },
    ],
  }
  document.sections = document.sections.map((section) => ({
    ...section,
    entries: entries[section.type as keyof typeof entries] ?? [],
  }))
  return document
}
