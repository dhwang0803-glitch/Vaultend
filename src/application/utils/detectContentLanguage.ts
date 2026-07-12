export function detectContentLanguage(text: string): 'en' | 'ko' {
  const stripped = text.replace(/\s+/g, '');
  if (stripped.length === 0) return 'en';

  let asciiCount = 0;
  for (let i = 0; i < stripped.length; i++) {
    const code = stripped.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7E) asciiCount++;
  }

  return (asciiCount / stripped.length) > 0.5 ? 'en' : 'ko';
}
