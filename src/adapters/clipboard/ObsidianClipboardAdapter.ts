import { ClipboardPort } from '../../application/ports/ClipboardPort';

/**
 * Obsidian 환경의 클립보드 어댑터.
 *
 * navigator.clipboard API를 사용한다.
 * Obsidian 데스크톱과 모바일 모두에서 동작한다.
 */
export class ObsidianClipboardAdapter implements ClipboardPort {
  async read(): Promise<string | null> {
    try {
      const text = await navigator.clipboard.readText();
      return text && text.trim().length > 0 ? text : null;
    } catch {
      // 클립보드 접근 권한이 없거나 비어 있는 경우
      return null;
    }
  }
}
