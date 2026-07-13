import { NoteChunk } from '../domain/models/NoteChunk';
import { detectContentLanguage } from './utils/detectContentLanguage';

type Lang = 'en' | 'ko';

export const PromptTemplates = {

  classificationSystemPrompt(lang: Lang): string {
    if (lang === 'en') {
      return `You are an expert in note classification and tagging.

Core rules:
1. Base your analysis ONLY on what is actually written in the "Note content" section.
2. Do not infer or fabricate information not present in the note.
3. The summary must only summarize what is actually written in the note. Do not mix tag or folder information into the summary.
4. The tag/folder lists are merely "options" — do not select them without evidence from the note content.
5. You must respond ONLY in valid JSON format.`;
    }
    return `당신은 노트 분류 및 태깅 전문가입니다.

핵심 규칙:
1. 오직 "노트 내용" 섹션에 실제로 적혀 있는 내용만 기반으로 분석하세요.
2. 노트에 없는 내용을 추측하거나 만들어내지 마세요.
3. summary는 노트에 실제로 적힌 내용만 한 문장으로 요약하세요. 태그나 폴더 정보를 요약에 섞지 마세요.
4. 태그/폴더 목록은 "선택지"일 뿐이며, 노트 내용의 근거 없이 선택하지 마세요.
5. 반드시 유효한 JSON 형식으로만 응답하세요.`;
  },

  quickAsk(question: string, contextChunks: ReadonlyArray<NoteChunk>): string {
    const lang = detectContentLanguage(question);
    const contextSection = contextChunks.length > 0
      ? `\n\n## ${lang === 'en' ? 'Related Note Context' : '관련 노트 컨텍스트'}\n\n${contextChunks.map((chunk, i) =>
          `### ${lang === 'en' ? 'Context' : '컨텍스트'} ${i + 1}\n${chunk.text}`
        ).join('\n\n')}`
      : '';

    if (lang === 'en') {
      return `You are an assistant that answers questions based on the user's personal knowledge base (Obsidian Vault).

Answer the question using the context provided below. If information is not in the context, you may use general knowledge but clearly distinguish it from context-based information.

Answer format:
- Write in markdown format
- Reference existing notes using [[wikilink]] format when relevant
- Organize key points in a structured manner
${contextSection}

## Question
${question}`;
    }

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

  classifyAndTag(noteContent: string, existingTags: ReadonlyArray<string>, currentNoteTags?: ReadonlyArray<string>, existingFolders?: ReadonlyArray<string>): string {
    const lang = detectContentLanguage(noteContent);

    if (lang === 'en') {
      const tagsInfo = existingTags.length > 0
        ? `\nAvailable existing tags (by frequency): ${existingTags.join(', ')}\n\n⚠️ Important: You MUST choose only from the existing tags above. Only suggest at most 1 new tag if none of the existing tags are appropriate. Reusing existing tags is the top priority to keep the vault maintainable.`
        : `\nThis vault has no tags yet. Extract exactly 3 tags from the note's key concepts. Tags should be general, concise (1-2 words), and reusable. Avoid overly specific tags that only apply to this note.`;
      const currentInfo = currentNoteTags && currentNoteTags.length > 0
        ? `\nTags already applied to this note: ${currentNoteTags.join(', ')}\nDo not suggest tags that are already applied. Only suggest new ones.`
        : '';
      const folderInfo = existingFolders && existingFolders.length > 0
        ? `\nExisting folders: ${existingFolders.join(', ')}\nChoose the most appropriate folder for this note. Prefer existing folders. Only suggest a new folder name if no existing folder fits at all.`
        : '\nNo folders exist yet. Suggest a short, general folder name that could hold similar notes (e.g., "Projects", "Learning", "Work").';

      return `Read the "Note content" section below and suggest tags that match the topics this note actually covers.
${tagsInfo}${currentInfo}${folderInfo}

## Analysis procedure (you MUST follow this)
1. Read the note content and identify **2-3 unique key topics/concepts** the note covers.
2. Select/create tags corresponding to those topics. Never select tags unrelated to the note content.
3. Determine the best folder to store this note (existing folder preferred, new folder name if nothing fits).
4. Summarize only what is written in the note.

## Response format (JSON only)
{
  "tags": ["#tag1", "#tag2", "#tag3"],
  "folder": "target folder path (never null — always recommend a folder)",
  "summary": "one sentence summarizing only what is actually written in the note",
  "confidence": 0.85
}

---
Note content:
${noteContent}`;
    }

    const tagsInfo = existingTags.length > 0
      ? `\n사용 가능한 기존 태그 (빈도순): ${existingTags.join(', ')}\n\n⚠️ 중요: 반드시 위 기존 태그 중에서만 선택하세요. 기존 태그 중 적합한 것이 전혀 없는 경우에만 새 태그를 최대 1개까지 제안할 수 있습니다. 태그가 늘어나면 vault 유지보수가 어려워지므로 기존 태그 재사용을 최우선으로 하세요.`
      : `\n이 vault에는 아직 태그가 없습니다. 노트 내용에서 핵심 개념을 추출하여 태그를 정확히 3개 생성하세요. 태그는 재사용 가능하도록 일반적이고 간결한 단어(1~2단어)로 만드세요. 지나치게 구체적이거나 이 노트에만 적용되는 태그는 피하세요.`;
    const currentInfo = currentNoteTags && currentNoteTags.length > 0
      ? `\n이 노트에 이미 적용된 태그: ${currentNoteTags.join(', ')}\n이미 적용된 태그는 제안하지 마세요. 새로운 태그만 제안하세요.`
      : '';
    const folderInfo = existingFolders && existingFolders.length > 0
      ? `\n기존 폴더 목록: ${existingFolders.join(', ')}\n이 노트에 가장 적합한 폴더를 선택하세요. 기존 폴더를 우선하되, 적합한 것이 전혀 없으면 새 폴더명을 제안하세요.`
      : '\n아직 폴더가 없습니다. 유사한 노트를 묶을 수 있는 짧고 일반적인 폴더명을 제안하세요 (예: "Projects", "Learning", "Work").';

    return `아래 "노트 내용" 섹션을 읽고, 이 노트가 실제로 다루는 주제에 맞는 태그를 제안하세요.
${tagsInfo}${currentInfo}${folderInfo}

## 분석 절차 (반드시 따르세요)
1. 노트 내용을 읽고, 이 노트가 다루는 **고유한 핵심 주제/개념 2~3개**를 파악하세요.
2. 파악한 주제에 해당하는 태그를 선택/생성하세요. 노트 내용과 무관한 태그는 절대 선택하지 마세요.
3. 이 노트를 저장할 최적의 폴더를 결정하세요 (기존 폴더 우선, 없으면 새 폴더명 제안).
4. summary는 노트에 적힌 내용만 요약하세요.

## 응답 형식 (JSON만)
{
  "tags": ["#태그1", "#태그2", "#태그3"],
  "folder": "대상 폴더 경로 (null 금지 — 항상 폴더를 추천하세요)",
  "summary": "노트에 실제로 적힌 내용만 한 문장으로 요약",
  "confidence": 0.85
}

---
노트 내용:
${noteContent}`;
  },

  suggestLinks(noteContent: string, availableNotes: ReadonlyArray<string>): string {
    const lang = detectContentLanguage(noteContent);

    if (lang === 'en') {
      return `Find existing notes that may be related to the following note.

Existing notes:
${availableNotes.map(n => `- ${n}`).join('\n')}

Current note content:
---
${noteContent}
---

Respond with related notes as a JSON array:
["note1", "note2", ...]

If no notes are related, return an empty array [].`;
    }

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

  extractSearchKeywords(question: string): string {
    const lang = detectContentLanguage(question);

    if (lang === 'en') {
      return `Extract the core search keywords from the user's question below.
Your goal is to produce short, precise keywords that will work well in a BM25 keyword search engine.

Rules:
1. Extract entity names, proper nouns, and key concepts as-is (do not translate or paraphrase).
2. Remove filler words, particles, and conversational phrases.
3. If the question references a person/character name, include the exact name.
4. Return 1-5 keywords, ordered by importance.
5. Respond ONLY with a JSON object: {"keywords": ["word1", "word2"]}. No explanation.

Question: ${question}

Example:
Question: "Tell me about the relationship between Alice and Bob"
Answer: {"keywords": ["Alice", "Bob", "relationship"]}

Answer:`;
    }

    return `아래 사용자 질문에서 핵심 검색 키워드를 추출하세요.
BM25 키워드 검색 엔진에서 잘 동작할 짧고 정확한 키워드를 만들어야 합니다.

규칙:
1. 고유명사, 인물명, 핵심 개념은 원형 그대로 추출하세요 (조사 제거).
2. "알려줘", "찾아줘", "대해서" 같은 대화체 표현은 제거하세요.
3. 인물/캐릭터 이름이 있으면 반드시 이름 원형을 포함하세요.
4. 1~5개 키워드를 중요도 순으로 반환하세요.
5. 반드시 JSON 객체로만 응답하세요: {"keywords": ["키워드1", "키워드2"]}. 설명 금지.

질문: ${question}

예시:
질문: "서울에서 열리는 축제에 대해 알려줘"
답변: {"keywords": ["서울", "축제"]}

질문: "프로젝트 일정이랑 담당자가 누구야?"
답변: {"keywords": ["프로젝트", "일정", "담당자"]}

답변:`;
  },

  summarize(noteContent: string): string {
    const lang = detectContentLanguage(noteContent);

    if (lang === 'en') {
      return `Summarize the following note in 2-3 sentences. Include key keywords.

Note content:
---
${noteContent}
---

Summary:`;
    }

    return `다음 노트의 내용을 2-3문장으로 요약하세요. 핵심 키워드를 포함하세요.

노트 내용:
---
${noteContent}
---

요약:`;
  },
};
