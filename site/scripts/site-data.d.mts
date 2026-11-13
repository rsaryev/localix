export type Release = { version: string; date: string; summary: string; changes: number };
export function releases(text: string): Release[];
export function siteData(root: string, dir?: string): { files: string[]; titles: Record<string, string>; releases: Release[] };
