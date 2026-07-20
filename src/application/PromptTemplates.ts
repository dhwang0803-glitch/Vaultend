import { detectContentLanguage } from './utils/detectContentLanguage';

type Lang = 'en' | 'ko';

export const PromptTemplates = {

  classificationSystemPrompt(lang: Lang): string {
    if (lang === 'en') {
      return `You are an expert in note classification and tagging.

Core rules:
1. Base your analysis ONLY on what is actually written in the "Note content" section.
2. Do not infer or fabricate information not present in the note.
3. The summary must only summarize what is actually written in the note. Do not mix tag information into the summary.
4. The tag lists are merely "options" — do not select them without evidence from the note content.
5. You must respond ONLY in valid JSON format.`;
    }
    return `당신은 노트 분류 및 태깅 전문가입니다.

핵심 규칙:
1. 오직 "노트 내용" 섹션에 실제로 적혀 있는 내용만 기반으로 분석하세요.
2. 노트에 없는 내용을 추측하거나 만들어내지 마세요.
3. summary는 노트에 실제로 적힌 내용만 한 문장으로 요약하세요. 태그 정보를 요약에 섞지 마세요.
4. 태그 목록은 "선택지"일 뿐이며, 노트 내용의 근거 없이 선택하지 마세요.
5. 반드시 유효한 JSON 형식으로만 응답하세요.`;
  },

  classifyAndTag(noteContent: string, existingTags: ReadonlyArray<string>, locale?: 'en' | 'ko', availableNotes?: ReadonlyArray<string>): string {
    const lang = locale ?? detectContentLanguage(noteContent);

    const hasNotes = availableNotes && availableNotes.length > 0;

    if (lang === 'en') {
      const tagsInfo = existingTags.length > 0
        ? `\nAvailable existing tags (by frequency): ${existingTags.join(', ')}\n\nTag selection rules:\n- Prefer existing tags that are STRONGLY relevant to the note content. Score existing tags 5-10 points higher when equally relevant.\n- If an existing tag is only weakly or vaguely related, do NOT force it — create a new tag instead.\n- New tags are allowed freely, but MUST NOT overlap semantically with any existing tag.\n- For each tag, provide: score (0-100), isNew (true if not in existing tags), and a brief reason (why this tag fits).`
        : `\nThis vault has no tags yet. Extract exactly 3 tags from the note's key concepts. Tags should be general, concise (1-2 words), and reusable. Avoid overly specific tags that only apply to this note. For each tag, provide: score (0-100), isNew (always true for new vaults), and a brief reason.`;

      const notesInfo = hasNotes
        ? `\n\nAvailable notes for linking (select up to 5 that are directly related):\n${availableNotes!.map(n => `- ${n}`).join('\n')}`
        : '';

      const linkStep = hasNotes
        ? `\n3. From the available notes list, select up to 5 notes whose topics directly relate to this note's content. Only select notes with strong topical relevance. If none are related, return an empty array.`
        : '';

      const summaryStepNum = hasNotes ? '4' : '3';

      const relatedNotesFormat = hasNotes
        ? `\n  "relatedNotes": ["NoteName1", "NoteName2"],`
        : '';

      return `Read the "Note content" section below and suggest tags that match the topics this note actually covers.
${tagsInfo}${notesInfo}

## Analysis procedure (you MUST follow this)
1. Read the note content and identify **2-3 unique key topics/concepts** the note covers.
2. For each topic, check existing tags first. Only use an existing tag if it clearly and directly matches (score ≥ 70). If no existing tag is a strong match, create a new tag.${linkStep}
${summaryStepNum}. Summarize only what is written in the note. Write the summary in English.

## Response format (JSON only)
{
  "tags": [
    {"tag": "#tag1", "score": 92, "isNew": false, "reason": "brief reason why this tag fits"},
    {"tag": "#tag2", "score": 78, "isNew": true, "reason": "brief reason"}
  ],${relatedNotesFormat}
  "summary": "one sentence summarizing only what is actually written in the note (in English)",
  "confidence": 0.85
}

---
Note content:
${noteContent}`;
    }

    const tagsInfo = existingTags.length > 0
      ? `\n사용 가능한 기존 태그 (빈도순): ${existingTags.join(', ')}\n\n태그 선택 규칙:\n- 노트 내용과 **강하게** 관련된 기존 태그만 선택하세요. 동등한 관련성이면 기존 태그를 5-10점 높게 점수를 부여하세요.\n- 약하거나 모호하게만 관련된 기존 태그는 억지로 선택하지 마세요 — 대신 새 태그를 만드세요.\n- 새 태그는 자유롭게 생성 가능하지만, 기존 태그와 의미가 겹치면 안 됩니다.\n- 각 태그마다: score(0-100), isNew(기존 태그에 없으면 true), reason(이 태그가 적합한 이유)을 부여하세요.`
      : `\n이 vault에는 아직 태그가 없습니다. 노트 내용에서 핵심 개념을 추출하여 태그를 정확히 3개 생성하세요. 태그는 재사용 가능하도록 일반적이고 간결한 단어(1~2단어)로 만드세요. 지나치게 구체적이거나 이 노트에만 적용되는 태그는 피하세요. 각 태그마다: score(0-100), isNew(새 vault이므로 항상 true), reason(간단한 이유)을 부여하세요.`;

    const notesInfo = hasNotes
      ? `\n\n링크 가능한 노트 목록 (직접 관련된 노트를 최대 5개 선택):\n${availableNotes!.map(n => `- ${n}`).join('\n')}`
      : '';

    const linkStepKo = hasNotes
      ? `\n3. 위의 노트 목록에서 이 노트의 주제와 직접 관련된 노트를 최대 5개 선택하세요. 주제적 관련성이 강한 노트만 선택하세요. 관련 노트가 없으면 빈 배열을 반환하세요.`
      : '';

    const summaryStepNumKo = hasNotes ? '4' : '3';

    const relatedNotesFormatKo = hasNotes
      ? `\n  "relatedNotes": ["노트이름1", "노트이름2"],`
      : '';

    return `아래 "노트 내용" 섹션을 읽고, 이 노트가 실제로 다루는 주제에 맞는 태그를 제안하세요.
${tagsInfo}${notesInfo}

## 분석 절차 (반드시 따르세요)
1. 노트 내용을 읽고, 이 노트가 다루는 **고유한 핵심 주제/개념 2~3개**를 파악하세요.
2. 각 주제에 대해 기존 태그를 먼저 확인하세요. 명확하고 직접적으로 일치하는 경우(score ≥ 70)에만 기존 태그를 사용하세요. 강한 매칭이 없으면 새 태그를 만드세요.${linkStepKo}
${summaryStepNumKo}. summary는 노트에 적힌 내용만 한국어로 요약하세요.

## 응답 형식 (JSON만)
{
  "tags": [
    {"tag": "#태그1", "score": 92, "isNew": false, "reason": "이 태그가 적합한 간단한 이유"},
    {"tag": "#태그2", "score": 78, "isNew": true, "reason": "간단한 이유"}
  ],${relatedNotesFormatKo}
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
