export interface TruncationResult {
  readonly content: string;
  readonly wasTruncated: boolean;
  readonly originalLength: number;
  readonly truncatedLength: number;
}

export const CONTENT_HARD_CAP = 15_000;
const SECTION_PRESERVE_RATIO = 0.75;
const HEADING_REGEX = /^#{1,6}\s+/m;
const SECTION_SPLIT_REGEX = /^(#{1,6}\s+.*)$/gm;

function createMarker(omittedChars: number): string {
  return `\n[... ${omittedChars} chars omitted ...]`;
}

function truncatePlain(content: string, cap: number): string {
  const preserveLength = Math.floor(cap * SECTION_PRESERVE_RATIO);
  const omitted = content.length - preserveLength;
  return content.slice(0, preserveLength) + createMarker(omitted);
}

function splitIntoSections(content: string): string[] {
  const headingMatches: { index: number }[] = [];
  const regex = new RegExp(SECTION_SPLIT_REGEX.source, 'gm');
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    headingMatches.push({ index: m.index });
  }

  if (headingMatches.length === 0) return [content];

  const sections: string[] = [];
  if (headingMatches[0].index > 0) {
    sections.push(content.slice(0, headingMatches[0].index));
  }
  for (let i = 0; i < headingMatches.length; i++) {
    const start = headingMatches[i].index;
    const end = i + 1 < headingMatches.length
      ? headingMatches[i + 1].index
      : content.length;
    sections.push(content.slice(start, end));
  }
  return sections;
}

function extractHeadingLine(section: string): { heading: string; body: string } {
  const firstNewline = section.indexOf('\n');
  if (firstNewline < 0) return { heading: section, body: '' };
  return {
    heading: section.slice(0, firstNewline + 1),
    body: section.slice(firstNewline + 1),
  };
}

function truncateMiddle(section: string, budget: number): string {
  if (section.length <= budget) return section;

  const { heading, body } = extractHeadingLine(section);

  if (budget <= heading.length) {
    return heading.slice(0, budget);
  }

  const bodyBudget = budget - heading.length;
  const markerTemplate = createMarker(0);
  const reserveForMarker = markerTemplate.length + 6;

  if (bodyBudget <= reserveForMarker) {
    return heading;
  }

  const kept = bodyBudget - reserveForMarker;
  const omitted = body.length - kept;
  return heading + body.slice(0, kept) + createMarker(omitted);
}

function truncateSections(sections: string[], cap: number): string {
  if (sections.length <= 2) {
    const joined = sections.join('');
    if (joined.length <= cap) return joined;
    return truncatePlain(joined, cap);
  }

  const first = sections[0];
  const last = sections[sections.length - 1];
  const middles = sections.slice(1, -1);

  const result75 = first
    + middles.map(s => truncateMiddle(s, Math.floor(s.length * SECTION_PRESERVE_RATIO))).join('')
    + last;
  if (result75.length <= cap) return result75;

  const fixedLen = first.length + last.length;

  if (fixedLen <= cap) {
    const middlesBudget = cap - fixedLen;
    const budgetPerMiddle = Math.floor(middlesBudget / middles.length);
    const truncatedMiddles = middles.map(s => truncateMiddle(s, budgetPerMiddle));
    const result = first + truncatedMiddles.join('') + last;
    if (result.length <= cap) return result;
    return (first + truncatedMiddles.join('') + last).slice(0, cap);
  }

  const halfCap = Math.floor(cap / 2);
  if (first.length <= halfCap) {
    return first + last.slice(0, cap - first.length);
  }
  if (last.length <= halfCap) {
    return first.slice(0, cap - last.length) + last;
  }
  return first.slice(0, halfCap) + last.slice(0, cap - halfCap);
}

export function truncateNoteContent(
  content: string,
  hardCap: number = CONTENT_HARD_CAP,
): TruncationResult {
  if (content.length <= hardCap) {
    return {
      content,
      wasTruncated: false,
      originalLength: content.length,
      truncatedLength: content.length,
    };
  }

  const hasHeadings = HEADING_REGEX.test(content);
  let truncated: string;

  if (hasHeadings) {
    const sections = splitIntoSections(content);
    truncated = truncateSections(sections, hardCap);
  } else {
    truncated = truncatePlain(content, hardCap);
  }

  return {
    content: truncated,
    wasTruncated: true,
    originalLength: content.length,
    truncatedLength: truncated.length,
  };
}

export function extractHeadings(content: string): ReadonlyArray<string> {
  const matches = content.match(/^#{1,6}\s+(.+)/gm);
  if (!matches) return [];
  return matches.map(h => h.replace(/^#{1,6}\s+/, '').trim());
}
