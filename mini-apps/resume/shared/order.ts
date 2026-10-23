import { sectionTypes, type ResumeEntry, type ResumeSection } from './schema'
export function byRecency(a: ResumeEntry, b: ResumeEntry): number {
  const endA = a.current || !a.end ? '9999-99' : a.end.padEnd(7, '-12')
  const endB = b.current || !b.end ? '9999-99' : b.end.padEnd(7, '-12')
  return endB.localeCompare(endA) || b.start.localeCompare(a.start)
}
export function defaultSectionOrder(sections: ResumeSection[]): ResumeSection[] {
  return [...sections].sort((a, b) => sectionTypes.indexOf(a.type) - sectionTypes.indexOf(b.type))
}
