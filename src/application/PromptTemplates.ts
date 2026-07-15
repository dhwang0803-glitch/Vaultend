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

Rules:
1. First, check if the context below is ACTUALLY RELEVANT to the question. If it is not related, IGNORE the context entirely.
2. If the context is relevant, answer based on it and reference notes using [[wikilink]] format.
3. If you cannot answer reliably (context is irrelevant AND you lack confident knowledge), say so honestly. Do NOT fabricate an answer by combining unrelated context.
4. If you use general knowledge (not from context), clearly state it is not from the vault.

Answer format:
- Write in markdown format
- Organize key points in a structured manner
${contextSection}

## Question
${question}`;
    }

    return `당신은 사용자의 개인 지식 베이스(Obsidian Vault)를 기반으로 질문에 답변하는 어시스턴트입니다.

규칙:
1. 먼저 아래 컨텍스트가 질문과 실제로 관련이 있는지 판단하세요. 관련이 없으면 컨텍스트를 완전히 무시하세요.
2. 컨텍스트가 관련 있으면 그것을 기반으로 답변하고, [[wikilink]] 형식으로 노트를 참조하세요.
3. 확실하게 답변할 수 없는 경우(컨텍스트가 무관하고 확신 있는 지식도 없는 경우), 솔직하게 모른다고 답하세요. 관련 없는 컨텍스트를 조합하여 답변을 지어내지 마세요.
4. 일반 지식을 사용할 경우, vault의 내용이 아님을 명시하세요.

답변 형식:
- 마크다운 형식으로 작성
- 핵심 포인트를 구조화하여 정리
${contextSection}

## 질문
${question}`;
  },

  classifyAndTag(noteContent: string, existingTags: ReadonlyArray<string>, currentNoteTags?: ReadonlyArray<string>, existingFolders?: ReadonlyArray<string>, currentFolder?: string, locale?: 'en' | 'ko'): string {
    const lang = locale ?? detectContentLanguage(noteContent);

    if (lang === 'en') {
      const tagsInfo = existingTags.length > 0
        ? `\nAvailable existing tags (by frequency): ${existingTags.join(', ')}\n\nTag selection rules:\n- Prefer existing tags that are STRONGLY relevant to the note content.\n- If an existing tag is only weakly or vaguely related, do NOT force it — create a new tag instead.\n- New tags are allowed freely, but MUST NOT overlap semantically with any existing tag.\n- For each tag, provide a confidence score (0.0–1.0) indicating how directly relevant the tag is to this note's actual content.`
        : `\nThis vault has no tags yet. Extract exactly 3 tags from the note's key concepts. Tags should be general, concise (1-2 words), and reusable. Avoid overly specific tags that only apply to this note. For each tag, provide a confidence score (0.0–1.0).`;
      const currentInfo = currentNoteTags && currentNoteTags.length > 0
        ? `\nTags already applied to this note: ${currentNoteTags.join(', ')}\nDo not suggest tags that are already applied. Only suggest new ones.`
        : '';
      const currentFolderInfo = currentFolder ? `\nThis note is currently in folder: "${currentFolder}"` : '';
      const folderInfo = existingFolders && existingFolders.length > 0
        ? `\nExisting folders: ${existingFolders.join(', ')}${currentFolderInfo}\nChoose the most appropriate folder for this note. If the current folder is already appropriate, return the current folder path. Only suggest a different folder if a clearly better one exists.`
        : '\nNo folders exist yet. Suggest a short, general folder name that could hold similar notes (e.g., "Projects", "Learning", "Work").';

      return `Read the "Note content" section below and suggest tags that match the topics this note actually covers.
${tagsInfo}${currentInfo}${folderInfo}

## Analysis procedure (you MUST follow this)
1. Read the note content and identify **2-3 unique key topics/concepts** the note covers.
2. For each topic, check existing tags first. Only use an existing tag if it clearly and directly matches (confidence ≥ 0.7). If no existing tag is a strong match, create a new tag.
3. Determine the best folder to store this note. If the note's current folder is already a good fit, keep it there. Only suggest a different folder if it is clearly more appropriate.
4. Summarize only what is written in the note. Write the summary in English.

## Response format (JSON only)
{
  "tags": [
    {"tag": "#tag1", "confidence": 0.92},
    {"tag": "#tag2", "confidence": 0.78}
  ],
  "folder": "target folder path",
  "summary": "one sentence summarizing only what is actually written in the note (in English)",
  "confidence": 0.85
}

---
Note content:
${noteContent}`;
    }

    const tagsInfo = existingTags.length > 0
      ? `\n사용 가능한 기존 태그 (빈도순): ${existingTags.join(', ')}\n\n태그 선택 규칙:\n- 노트 내용과 **강하게** 관련된 기존 태그만 선택하세요.\n- 약하거나 모호하게만 관련된 기존 태그는 억지로 선택하지 마세요 — 대신 새 태그를 만드세요.\n- 새 태그는 자유롭게 생성 가능하지만, 기존 태그와 의미가 겹치면 안 됩니다.\n- 각 태그마다 이 노트 내용과의 직접적 관련도를 나타내는 confidence 점수(0.0~1.0)를 부여하세요.`
      : `\n이 vault에는 아직 태그가 없습니다. 노트 내용에서 핵심 개념을 추출하여 태그를 정확히 3개 생성하세요. 태그는 재사용 가능하도록 일반적이고 간결한 단어(1~2단어)로 만드세요. 지나치게 구체적이거나 이 노트에만 적용되는 태그는 피하세요. 각 태그마다 confidence 점수(0.0~1.0)를 부여하세요.`;
    const currentInfo = currentNoteTags && currentNoteTags.length > 0
      ? `\n이 노트에 이미 적용된 태그: ${currentNoteTags.join(', ')}\n이미 적용된 태그는 제안하지 마세요. 새로운 태그만 제안하세요.`
      : '';
    const currentFolderInfo = currentFolder ? `\n이 노트의 현재 위치: "${currentFolder}"` : '';
    const folderInfo = existingFolders && existingFolders.length > 0
      ? `\n기존 폴더 목록: ${existingFolders.join(', ')}${currentFolderInfo}\n이 노트에 가장 적합한 폴더를 선택하세요. 현재 폴더가 이미 적합하면 현재 폴더 경로를 그대로 반환하세요. 명확히 더 적합한 폴더가 있을 때만 다른 폴더를 추천하세요.`
      : '\n아직 폴더가 없습니다. 유사한 노트를 묶을 수 있는 짧고 일반적인 폴더명을 제안하세요 (예: "Projects", "Learning", "Work").';

    return `아래 "노트 내용" 섹션을 읽고, 이 노트가 실제로 다루는 주제에 맞는 태그를 제안하세요.
${tagsInfo}${currentInfo}${folderInfo}

## 분석 절차 (반드시 따르세요)
1. 노트 내용을 읽고, 이 노트가 다루는 **고유한 핵심 주제/개념 2~3개**를 파악하세요.
2. 각 주제에 대해 기존 태그를 먼저 확인하세요. 명확하고 직접적으로 일치하는 경우(confidence ≥ 0.7)에만 기존 태그를 사용하세요. 강한 매칭이 없으면 새 태그를 만드세요.
3. 이 노트를 저장할 최적의 폴더를 결정하세요. 현재 폴더가 이미 적절하면 그대로 유지하세요. 명확히 더 적합한 폴더가 있을 때만 다른 폴더를 추천하세요.
4. summary는 노트에 적힌 내용만 한국어로 요약하세요.

## 응답 형식 (JSON만)
{
  "tags": [
    {"tag": "#태그1", "confidence": 0.92},
    {"tag": "#태그2", "confidence": 0.78}
  ],
  "folder": "대상 폴더 경로",
  "summary": "노트에 실제로 적힌 내용만 한 문장으로 요약 (한국어로)",
  "confidence": 0.85
}

---
노트 내용:
${noteContent}`;
  },

  suggestLinks(noteContent: string, availableNotes: ReadonlyArray<string>): string {
    const lang = detectContentLanguage(noteContent);

    if (lang === 'en') {
      return `Find existing notes that are related to the following note.

⚠️ CRITICAL RULES:
1. You may ONLY select notes from the list below. Do NOT invent or modify note names.
2. A note is "related" only if the current note's content directly discusses or references the same topic.
3. Prefer fewer, highly relevant suggestions over many weak ones. Maximum 5 notes.
4. If no notes are genuinely related, return an empty array [].

Existing notes:
${availableNotes.map(n => `- ${n}`).join('\n')}

Current note content:
---
${noteContent}
---

Respond ONLY with a JSON array of note names from the list above:
["note1", "note2"]`;
    }

    return `다음 노트와 관련된 기존 노트를 찾아주세요.

⚠️ 필수 규칙:
1. 반드시 아래 목록에 있는 노트만 선택하세요. 노트 이름을 만들거나 변경하지 마세요.
2. 현재 노트 내용이 직접적으로 같은 주제를 다루는 경우에만 "관련"입니다.
3. 약한 연관보다 강한 연관 소수를 우선하세요. 최대 5개까지만 제안하세요.
4. 진정으로 관련된 노트가 없으면 빈 배열 []을 반환하세요.

기존 노트 목록:
${availableNotes.map(n => `- ${n}`).join('\n')}

현재 노트 내용:
---
${noteContent}
---

위 목록에 있는 노트 이름만 포함한 JSON 배열로 응답하세요:
["노트1", "노트2"]`;
  },

  classifyAndExtractKeywords(question: string): string {
    const lang = detectContentLanguage(question);

    if (lang === 'en') {
      return `Analyze the user's question below and determine its intent.

Step 1: Classify the intent.
- "vault": The question asks about specific notes, documents, people, topics, or information that could exist in a personal knowledge base.
- "general": The question is casual conversation (greetings, small talk), general knowledge that doesn't need personal notes, or meta-questions about the assistant itself.

Step 2: If intent is "vault", extract 1-5 BM25 search keywords (entity names, proper nouns, key concepts). If intent is "general", keywords should be an empty array.

Rules:
- Greetings ("hello", "hi", "how are you"), jokes, weather, time → "general"
- Questions mentioning specific document names, people, projects, topics → "vault"
- Ambiguous questions about concepts that COULD be in notes → "vault"
- Respond ONLY with JSON: {"intent": "vault"|"general", "keywords": [...]}

Question: ${question}

Examples:
Question: "Hello!"
Answer: {"intent": "general", "keywords": []}

Question: "Tell me about Alice's project notes"
Answer: {"intent": "vault", "keywords": ["Alice", "project"]}

Question: "What is machine learning?"
Answer: {"intent": "vault", "keywords": ["machine learning"]}

Answer:`;
    }

    return `아래 사용자 질문을 분석하여 의도를 판별하세요.

1단계: 의도 분류
- "vault": 특정 노트, 문서, 인물, 주제 등 개인 지식 베이스에 있을 수 있는 정보를 묻는 질문
- "general": 인사, 잡담, 일상 대화, 어시스턴트 자체에 대한 질문, 노트 검색이 불필요한 일반 지식 질문

2단계: intent가 "vault"면 BM25 검색용 키워드 1~5개 추출 (고유명사, 핵심 개념, 조사 제거). "general"이면 빈 배열.

규칙:
- 인사("안녕", "반가워"), 날씨, 시간, 농담 → "general"
- 특정 문서명, 인물명, 프로젝트명, 주제 언급 → "vault"
- 노트에 있을 수 있는 개념 질문 → "vault"
- 반드시 JSON으로만 응답: {"intent": "vault"|"general", "keywords": [...]}

질문: ${question}

예시:
질문: "안녕하세요"
답변: {"intent": "general", "keywords": []}

질문: "이도진 문서 읽어서 요약해줘"
답변: {"intent": "vault", "keywords": ["이도진"]}

질문: "머신러닝이 뭐야?"
답변: {"intent": "vault", "keywords": ["머신러닝"]}

답변:`;
  },

  quickAskGeneral(question: string): string {
    const lang = detectContentLanguage(question);

    if (lang === 'en') {
      return `You are a friendly assistant inside an Obsidian Vault plugin called Vaultend.
The user asked a casual or general question that doesn't require searching their notes.
Answer naturally and concisely in markdown format.

## Question
${question}`;
    }

    return `당신은 Obsidian Vault 플러그인 Vaultend의 친근한 어시스턴트입니다.
사용자가 노트 검색이 필요 없는 일상적이거나 일반적인 질문을 했습니다.
자연스럽고 간결하게 마크다운 형식으로 답변하세요.

## 질문
${question}`;
  },

  quickAskChatSystem(contextChunks: ReadonlyArray<NoteChunk>, lang?: Lang): string {
    const detectedLang = lang ?? 'ko';
    const contextSection = contextChunks.length > 0
      ? contextChunks.map((chunk, i) =>
          `### ${detectedLang === 'en' ? 'Context' : '컨텍스트'} ${i + 1}\n${chunk.text}`
        ).join('\n\n')
      : '';

    if (detectedLang === 'en') {
      return `You are a specialist assistant for the user's personal knowledge base (Obsidian Vault).

Rules:
1. Answer based on the vault context below. You may use general knowledge to analyze, verify, or supplement the context.
2. If the question is unrelated to any vault context in this conversation, respond: "No related notes found in your vault."
3. Reference related notes using [[wikilink]] format.
4. Write in structured markdown format.

## Vault Context
${contextSection}`;
    }

    return `당신은 사용자의 Obsidian Vault 개인 지식 베이스 전문 어시스턴트입니다.

규칙:
1. 아래 vault 컨텍스트를 기반으로 답변하세요. 컨텍스트의 내용을 분석, 검증, 보강하는 데 일반 지식을 활용할 수 있습니다.
2. 이 대화의 vault 컨텍스트와 무관한 질문에는 답변하지 마세요. "vault에서 관련 노트를 찾지 못했습니다."로 안내하세요.
3. 관련 노트는 [[wikilink]] 형식으로 참조하세요.
4. 마크다운 형식으로 구조화하여 답변하세요.

## Vault 컨텍스트
${contextSection}`;
  },

  quickAskNoResults(question: string): string {
    const lang = detectContentLanguage(question);
    if (lang === 'en') {
      return `No related notes found in your vault for "${question}". Try asking after creating relevant notes.`;
    }
    return `vault에서 "${question}"과 관련된 노트를 찾지 못했습니다. 관련 노트를 작성한 후 다시 질문해 보세요.`;
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
