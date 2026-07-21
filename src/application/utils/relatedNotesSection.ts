const RELATED_NOTES_PATTERN = /\n*## Related Notes\n[\s\S]*?(?=\n## |\s*$)/g;

export function stripRelatedNotesSection(content: string): string {
  return content.replace(RELATED_NOTES_PATTERN, '').trimEnd();
}

export function replaceRelatedNotesSection(content: string, links: ReadonlyArray<string>): string {
  const stripped = stripRelatedNotesSection(content);
  if (links.length === 0) return stripped;
  const linkLines = links.map(link => {
    const linkPath = link.replace(/\.md$/i, '');
    return `- [[${linkPath}]]`;
  });
  return stripped + `\n\n## Related Notes\n\n${linkLines.join('\n')}`;
}
