// The doc: a page of markdown under content/docs, read, checked and rendered at build time.
// Nothing here runs in a browser.
export { GROUPS, IMAGES, PAGES, REPO_FILES, type DocPage } from './content';
export { renderMarkdown, type Heading } from './markdown';
