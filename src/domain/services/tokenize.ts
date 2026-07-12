const EN_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up', 'down',
  'that', 'this', 'these', 'those', 'it', 'its', 'he', 'she', 'they',
  'them', 'his', 'her', 'their', 'my', 'your', 'our', 'we', 'you', 'me',
  'him', 'us', 'what', 'which', 'who', 'whom', 'whose',
]);

const KO_STOPWORDS = new Set([
  '이', '그', '저', '것', '수', '등', '및', '더', '또', '또는',
  '그리고', '하지만', '그러나', '때문', '위해', '대해', '통해',
  '따라', '관련', '경우', '때', '중', '후', '전', '간', '내',
]);

export function tokenizeForTfIdf(text: string): string[] {
  let cleaned = stripFrontmatter(text);
  cleaned = stripMarkdownSyntax(cleaned);
  cleaned = cleaned.toLowerCase();

  const tokens = cleaned.split(/[\s\p{P}]+/u).filter(t => t.length >= 2);

  return tokens.filter(t => !EN_STOPWORDS.has(t) && !KO_STOPWORDS.has(t));
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---[\s\S]*?---\s*/, '');
}

function stripMarkdownSyntax(text: string): string {
  let result = text;
  // Code blocks
  result = result.replace(/```[\s\S]*?```/g, '');
  result = result.replace(/`[^`]+`/g, '');
  // Headings
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Links: [[target|display]] → display, [[target]] → target
  result = result.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  result = result.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Markdown links: [text](url) → text
  result = result.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');
  // Images
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  // Bold/italic
  result = result.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');
  // HTML tags
  result = result.replace(/<[^>]+>/g, '');
  return result;
}
