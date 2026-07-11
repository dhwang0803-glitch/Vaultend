import { NoteChunk } from '../domain/models/NoteChunk';

/**
 * AI 호출에 사용되는 프롬프트 템플릿 모음.
 *
 * 모든 프롬프트는 한국어 기반이며, 사용자의 Vault 언어에 관계없이
 * 플러그인 내부 프롬프트는 일관된 형식을 유지한다.
 */
export const PromptTemplates = {

  classificationSystemPrompt: '당신은 노트 분류 및 태깅 전문가입니다. JSON 형식으로만 응답하세요.',

  /**
   * Quick Ask 프롬프트 — 질문에 대해 Vault 컨텍스트 기반 응답 생성
   */
  quickAsk(question: string, contextChunks: ReadonlyArray<NoteChunk>): string {
    const contextSection = contextChunks.length > 0
      ? `\n\n## 관련 노트 컨텍스트\n\n${contextChunks.map((chunk, i) =>
          `### 컨텍스트 ${i + 1}\n${chunk.text}`
        ).join('\n\n')}`
      : '';

    return `당신은 사용자의 개인 지식 베이스(Obsidian Vault)를 기반으로 질문에 답변하는 어시스턴트입니다.

아래 제공된 컨텍스트를 참고하여 질문에 답변하세요. 컨텍스트에 없는 정보는 일반 지식을 활용하되, 컨텍스트 기반 정보와 구분하여 표시하세요.

답변 형식:
- 마크다운 형식으로 작성
- 관련 있는 경우 [[wikilink]] 형식으로 기존 노트 참조
- 핵심 포인트를 구조화하여 정리
${contextSection}

## 질문
${question}`;
  },

  /**
   * 분류 및 태깅 프롬프트
   */
  classifyAndTag(noteContent: string, existingTags: ReadonlyArray<string>, currentNoteTags?: ReadonlyArray<string>, existingFolders?: ReadonlyArray<string>): string {
    const tagsInfo = existingTags.length > 0
      ? `\n사용 가능한 기존 태그 (빈도순): ${existingTags.join(', ')}\n\n⚠️ 중요: 반드시 위 기존 태그 중에서만 선택하세요. 기존 태그 중 적합한 것이 전혀 없는 경우에만 새 태그를 최대 1개까지 제안할 수 있습니다. 태그가 늘어나면 vault 유지보수가 어려워지므로 기존 태그 재사용을 최우선으로 하세요.`
      : `\n이 vault에는 아직 태그가 없습니다. 노트 내용에서 핵심 개념을 추출하여 태그를 정확히 3개 생성하세요. 태그는 재사용 가능하도록 일반적이고 간결한 단어(1~2단어)로 만드세요. 지나치게 구체적이거나 이 노트에만 적용되는 태그는 피하세요.`;
    const currentInfo = currentNoteTags && currentNoteTags.length > 0
      ? `\n이 노트에 이미 적용된 태그: ${currentNoteTags.join(', ')}\n이미 적용된 태그는 제안하지 마세요. 새로운 태그만 제안하세요.`
      : '';
    const folderInfo = existingFolders && existingFolders.length > 0
      ? `\n기존 폴더 목록: ${existingFolders.join(', ')}\n반드시 기존 폴더 중에서만 선택하세요. 현재 위치가 적절하면 folder를 null로 설정하세요.`
      : '';

    return `다음 노트의 내용을 분석하여 분류하고 적절한 태그를 제안하세요.
${tagsInfo}${currentInfo}${folderInfo}

반드시 아래 JSON 형식으로만 응답하세요:
{
  "category": "카테고리명 (예: 기술, 일상, 프로젝트, 학습, 업무 등)",
  "tags": ["#태그1", "#태그2", "#태그3"],
  "folder": "추천 폴더 경로 또는 null (현재 위치가 적절하면 null)",
  "summary": "노트 내용을 한 문장으로 요약",
  "confidence": 0.85
}

---
노트 내용:
${noteContent}`;
  },

  /**
   * 링크 제안 프롬프트
   */
  suggestLinks(noteContent: string, availableNotes: ReadonlyArray<string>): string {
    return `다음 노트와 관련이 있을 수 있는 기존 노트를 찾아주세요.

기존 노트 목록:
${availableNotes.map(n => `- ${n}`).join('\n')}

현재 노트 내용:
---
${noteContent}
---

관련 노트를 JSON 배열로 응답하세요:
["노트1", "노트2", ...]

관련 노트가 없으면 빈 배열 []을 반환하세요.`;
  },

  /**
   * 요약 프롬프트
   */
  summarize(noteContent: string): string {
    return `다음 노트의 내용을 2-3문장으로 요약하세요. 핵심 키워드를 포함하세요.

노트 내용:
---
${noteContent}
---

요약:`;
  },
};
