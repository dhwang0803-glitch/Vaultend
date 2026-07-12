/**
 * Golden Set: 실환경 임베딩 벤치마크용 데이터셋
 *
 * ## 설계 원칙
 * 1. Obsidian vault 실사용 패턴 반영 (개인 지식 관리 노트)
 * 2. 한국어 + 영어 혼합 (bilingual vault 시나리오)
 * 3. 의미적 유사성이 키워드 매칭과 불일치하는 케이스 포함
 *    → 임베딩이 BM25보다 나은 영역을 측정
 * 4. 다양한 난이도: easy (키워드 일치) / medium (패러프레이즈) / hard (의미만 관련)
 *
 * ## 쿼리 난이도 분류
 * - Easy: 쿼리 키워드가 문서에 직접 등장 (BM25도 잘 찾음)
 * - Medium: 동의어/패러프레이즈 사용 (BM25 약, embedding 강)
 * - Hard: 주제적 관련성만 존재 (embedding만 찾을 수 있음)
 */

export interface GoldenDocument {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly tags: ReadonlyArray<string>;
}

export interface GoldenQuery {
  readonly id: string;
  readonly query: string;
  readonly relevant: ReadonlyArray<string>;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly description: string;
}

export interface BenchmarkResult {
  readonly queryId: string;
  readonly method: string;
  readonly precisionAt3: number;
  readonly precisionAt5: number;
  readonly recallAt3: number;
  readonly recallAt5: number;
  readonly mrr: number;
  readonly topResults: ReadonlyArray<{ id: string; score: number }>;
}

// ─── 50 Golden Documents ───
// 실제 Obsidian vault에서 발생하는 다양한 주제/길이/스타일
export const GOLDEN_DOCUMENTS: GoldenDocument[] = [
  // === 프로그래밍 ===
  {
    id: 'react-hooks-guide',
    title: 'React Hooks 완전 가이드',
    content: `React Hooks는 함수형 컴포넌트에서 상태와 생명주기 기능을 사용할 수 있게 해준다.
useState는 로컬 상태 관리, useEffect는 사이드 이펙트 처리에 사용된다.
커스텀 훅을 만들면 상태 로직을 여러 컴포넌트에서 재사용할 수 있다.
useCallback과 useMemo는 불필요한 리렌더링을 방지하는 최적화 훅이다.`,
    tags: ['react', 'hooks', 'frontend'],
  },
  {
    id: 'react-state-management',
    title: 'React 상태 관리 전략',
    content: `React 앱의 상태 관리는 규모에 따라 다른 접근이 필요하다.
작은 앱: useState + prop drilling으로 충분.
중간 규모: useContext + useReducer 조합.
대규모: Zustand, Jotai 같은 외부 라이브러리 또는 서버 상태는 React Query.
전역 상태를 최소화하고 가능하면 서버에 상태를 두는 것이 최신 트렌드.`,
    tags: ['react', 'state', 'architecture'],
  },
  {
    id: 'typescript-advanced-patterns',
    title: 'TypeScript 고급 타입 패턴',
    content: `TypeScript의 조건부 타입(Conditional Types)은 타입 수준에서 if-else를 가능하게 한다.
Mapped Types로 기존 타입을 변환할 수 있다 (Partial, Required, Pick).
Template Literal Types는 문자열 패턴을 타입으로 표현한다.
infer 키워드로 타입 추론 로직을 작성할 수 있다.`,
    tags: ['typescript', 'types', 'advanced'],
  },
  {
    id: 'clean-architecture-principles',
    title: 'Clean Architecture 핵심 원칙',
    content: `Clean Architecture는 의존성 방향을 안쪽으로만 허용한다.
Domain 레이어: 비즈니스 규칙, 엔티티, 값 객체. 외부 의존 없음.
Application 레이어: 유스케이스, 포트(인터페이스). Domain만 참조.
Adapter 레이어: 구체 구현(DB, API, UI). Application 포트 구현.
의존성 역전 원칙(DIP)이 핵심 — 상위 모듈이 하위 모듈에 의존하지 않는다.`,
    tags: ['architecture', 'clean-arch', 'design'],
  },
  {
    id: 'nodejs-event-loop',
    title: 'Node.js 이벤트 루프 이해하기',
    content: `Node.js는 단일 스레드이지만 이벤트 루프를 통해 비동기 I/O를 처리한다.
Phases: timers → pending callbacks → idle → poll → check → close.
microtask queue(Promise)는 각 phase 사이에 처리된다.
process.nextTick은 microtask보다도 먼저 실행된다.
CPU 집약적 작업은 Worker Threads로 분리해야 한다.`,
    tags: ['nodejs', 'async', 'event-loop'],
  },
  {
    id: 'git-workflow-comparison',
    title: 'Git 워크플로우 비교',
    content: `Git Flow: main/develop/feature/release/hotfix 브랜치. 릴리즈 주기가 긴 프로젝트에 적합.
GitHub Flow: main + feature 브랜치만. CI/CD와 잘 맞음. 빠른 배포 주기.
Trunk-Based: 모든 개발자가 main에 직접 커밋. feature flag로 미완성 코드 숨김.
우리 프로젝트는 GitHub Flow 변형: main + development + feature/* 구조 사용.`,
    tags: ['git', 'workflow', 'branching'],
  },
  {
    id: 'docker-multi-stage',
    title: 'Docker 멀티스테이지 빌드',
    content: `멀티스테이지 빌드로 최종 이미지 크기를 줄일 수 있다.
첫 번째 stage: 빌드 도구 + 소스 → 컴파일/빌드.
두 번째 stage: 런타임만 포함하는 경량 베이스 이미지에 빌드 산출물 복사.
예: Node.js 앱은 node:18-slim 빌드 → node:18-alpine 실행.
.dockerignore로 불필요한 파일(node_modules, .git)을 컨텍스트에서 제외.`,
    tags: ['docker', 'build', 'optimization'],
  },
  {
    id: 'database-query-optimization',
    title: '데이터베이스 쿼리 최적화',
    content: `EXPLAIN ANALYZE로 실행 계획을 확인한다.
Sequential Scan이 보이면 인덱스 추가를 고려.
복합 인덱스는 WHERE 절의 컬럼 순서와 일치해야 효과적.
N+1 쿼리 문제는 JOIN이나 batch loading으로 해결.
대량 데이터는 파티셔닝으로 스캔 범위를 줄인다.`,
    tags: ['database', 'performance', 'sql'],
  },
  {
    id: 'testing-philosophy',
    title: '테스트 전략과 철학',
    content: `테스트 피라미드: 단위 테스트(많음) > 통합 테스트(중간) > E2E(적음).
단위 테스트는 빠르고 격리적. 비즈니스 로직 검증에 집중.
통합 테스트는 컴포넌트 간 상호작용 확인. DB, API 실제 호출.
TDD 사이클: Red(실패 테스트) → Green(최소 구현) → Refactor(정리).
100% 커버리지보다 핵심 경로의 높은 신뢰도가 중요.`,
    tags: ['testing', 'tdd', 'quality'],
  },
  {
    id: 'api-design-rest',
    title: 'REST API 설계 가이드',
    content: `리소스 중심 URL: /users/{id}/posts (동사 아닌 명사).
HTTP 메서드: GET(조회), POST(생성), PUT(전체수정), PATCH(부분수정), DELETE(삭제).
상태 코드 사용: 201 Created, 204 No Content, 400 Bad Request, 404 Not Found.
페이지네이션: cursor-based가 offset보다 대규모 데이터에 안정적.
버전닝: URL path(/v2/) 또는 Accept header.`,
    tags: ['api', 'rest', 'design'],
  },

  // === 생산성/방법론 ===
  {
    id: 'zettelkasten-method',
    title: 'Zettelkasten 메모법',
    content: `제텔카스텐은 니클라스 루만이 개발한 지식 관리 시스템이다.
핵심 원칙: 하나의 노트에 하나의 아이디어 (원자성).
노트 간 연결(링크)이 핵심 — 폴더 구조보다 중요.
Fleeting note → Literature note → Permanent note 흐름.
Obsidian의 백링크와 그래프 뷰가 디지털 제텔카스텐을 구현.`,
    tags: ['zettelkasten', 'pkm', 'note-taking'],
  },
  {
    id: 'pomodoro-technique',
    title: '포모도로 기법 실천',
    content: `25분 집중 + 5분 휴식을 1 포모도로로 한다.
4 포모도로 후 15-30분 긴 휴식.
핵심: 타이머가 울릴 때까지 절대 멈추지 않는다.
방해 요소가 발생하면 메모만 하고 현재 작업 계속.
하루 완료한 포모도로 수를 기록하면 생산성 추이를 파악.`,
    tags: ['productivity', 'focus', 'technique'],
  },
  {
    id: 'second-brain-building',
    title: 'Second Brain 구축하기',
    content: `Tiago Forte의 PARA 방법론: Projects, Areas, Resources, Archives.
Capture → Organize → Distill → Express (CODE 프레임워크).
정보를 소비만 하지 말고, 자신의 언어로 재가공하여 지식으로 전환.
Progressive Summarization: 볼드 → 하이라이트 → 요약문으로 단계적 증류.
디지털 노트 앱(Obsidian, Notion)이 Second Brain의 인프라.`,
    tags: ['pkm', 'second-brain', 'para'],
  },
  {
    id: 'deep-work-rules',
    title: 'Deep Work 규칙',
    content: `Cal Newport의 Deep Work: 인지적으로 요구가 높은 작업에 방해 없이 집중하는 능력.
규칙 1: 깊은 작업을 위한 의식(ritual)을 만들어라.
규칙 2: 지루함을 받아들여라 — 즉각적 자극을 줄여야 집중력이 회복된다.
규칙 3: 소셜 미디어를 끊어라 (또는 극도로 제한).
규칙 4: 얕은 작업(이메일, 회의)을 시간 블록으로 제한.`,
    tags: ['productivity', 'focus', 'deep-work'],
  },
  {
    id: 'habit-formation',
    title: '습관 형성의 과학',
    content: `James Clear의 원자적 습관: 1% 개선의 복리 효과.
습관 루프: 신호(Cue) → 갈망(Craving) → 반응(Response) → 보상(Reward).
좋은 습관 만들기: 분명하게(cue), 매력적으로(craving), 쉽게(response), 만족스럽게(reward).
나쁜 습관 깨기: 보이지 않게, 매력 없게, 어렵게, 불만족스럽게.
환경 설계가 의지력보다 강력하다.`,
    tags: ['habits', 'behavior', 'self-improvement'],
  },

  // === 인공지능/ML ===
  {
    id: 'transformer-architecture',
    title: 'Transformer 아키텍처',
    content: `Transformer는 Self-Attention 메커니즘으로 시퀀스를 병렬 처리한다.
Multi-Head Attention: 여러 관점에서 동시에 어텐션 계산.
Positional Encoding: 위치 정보를 사이너소이드 함수로 주입.
Encoder-Decoder 구조 (번역) vs Decoder-only (GPT) vs Encoder-only (BERT).
Scaling: 모델 크기를 키울수록 few-shot 능력이 emergent하게 발현.`,
    tags: ['ai', 'transformer', 'deep-learning'],
  },
  {
    id: 'embedding-models-comparison',
    title: '임베딩 모델 비교',
    content: `텍스트 임베딩은 문장/문서를 고밀도 벡터로 변환한다.
OpenAI text-embedding-3-small: 1536차원, 가성비 우수.
Gemini text-embedding-004: 768차원, 무료 쿼터 넉넉.
Cohere embed-v3: 1024차원, 다국어 지원 강점.
선택 기준: 차원 수, 비용, 다국어 성능, 최대 입력 토큰.
MTEB 리더보드에서 벤치마크 결과 비교 가능.`,
    tags: ['embedding', 'nlp', 'comparison'],
  },
  {
    id: 'rag-pipeline',
    title: 'RAG 파이프라인 설계',
    content: `Retrieval-Augmented Generation은 외부 지식을 LLM에 주입한다.
파이프라인: 문서 분할(chunking) → 임베딩 → 벡터 DB 저장 → 검색 → 생성.
Chunk 크기: 200-500 토큰이 일반적. 오버랩 50-100 토큰으로 문맥 보존.
Hybrid Search: BM25(키워드) + Dense Retrieval(시맨틱) → RRF 병합.
Re-ranking: 검색 결과를 Cross-Encoder로 재정렬하면 정확도 상승.`,
    tags: ['rag', 'llm', 'search'],
  },
  {
    id: 'vector-database-choices',
    title: '벡터 데이터베이스 선택',
    content: `벡터 DB는 고차원 벡터의 유사도 검색을 최적화한 저장소.
Pinecone: 완전 관리형, 스케일링 쉬움, 비용 높음.
Weaviate: 오픈소스, 하이브리드 검색 내장.
Qdrant: Rust 기반, 빠른 필터링, 셀프호스팅 적합.
ChromaDB: 경량, 로컬 개발에 좋음, 프로덕션에는 한계.
소규모(<100K 벡터)는 brute-force JSON도 충분.`,
    tags: ['vector-db', 'infrastructure', 'comparison'],
  },
  {
    id: 'prompt-engineering',
    title: '프롬프트 엔지니어링 기법',
    content: `효과적인 프롬프트 작성법:
1. 역할 부여: "당신은 시니어 백엔드 엔지니어입니다"
2. 구체적 지시: 모호한 요청보다 형식/제약 명시
3. Few-shot: 예시 2-3개로 원하는 출력 패턴 보여주기
4. Chain of Thought: "단계별로 생각해보세요"
5. 출력 형식 지정: JSON, 마크다운 테이블 등
Temperature 0에 가까울수록 결정적, 1에 가까울수록 창의적.`,
    tags: ['ai', 'prompt', 'llm'],
  },

  // === Obsidian 워크플로우 ===
  {
    id: 'obsidian-daily-notes',
    title: 'Obsidian Daily Notes 워크플로우',
    content: `Daily Note는 하루의 시작점이자 Inbox 역할을 한다.
템플릿: 날짜 헤더 + 할 일 + 메모 섹션 + 회고.
Fleeting thoughts를 빠르게 캡처 → 나중에 적절한 노트로 분류.
Daily Note → 주간 리뷰에서 미처리 항목 확인.
Dataview로 지난 주 Daily Notes의 TODO 완료율 자동 집계.`,
    tags: ['obsidian', 'daily-notes', 'workflow'],
  },
  {
    id: 'obsidian-tag-strategy',
    title: 'Obsidian 태그 전략',
    content: `태그는 폴더를 초월하는 횡단 분류 도구.
계층 태그: #dev/frontend, #dev/backend처럼 네임스페이스로 구분.
상태 태그: #status/draft, #status/published, #status/archived.
타입 태그: #type/tutorial, #type/reference, #type/journal.
주의: 너무 많은 태그는 오히려 검색 효율을 떨어뜨린다.
10-30개의 핵심 태그 세트를 유지하는 것이 이상적.`,
    tags: ['obsidian', 'tags', 'organization'],
  },
  {
    id: 'obsidian-plugin-development',
    title: 'Obsidian 플러그인 개발',
    content: `Obsidian 플러그인은 TypeScript로 작성하고 esbuild로 번들링한다.
Plugin API: app.vault (파일), app.workspace (뷰), app.metadataCache (링크/태그).
생명주기: onload(초기화) → 커맨드/뷰 등록 → onunload(정리).
설정: PluginSettingTab으로 UI 생성, loadData/saveData로 영속화.
배포: manifest.json + main.js + styles.css를 릴리즈.
BRAT으로 베타 배포, 커뮤니티 플러그인 목록에 등록하려면 리뷰 통과 필요.`,
    tags: ['obsidian', 'plugin', 'development'],
  },
  {
    id: 'obsidian-linking-strategy',
    title: 'Obsidian 링킹 전략',
    content: `Obsidian에서 링크는 지식의 연결을 물리적으로 구현한다.
[[wikilink]] vs [markdown link]: wikilink가 리네임에 강함.
MOC (Map of Content): 특정 주제의 관문 노트. 하위 노트를 링크로 나열.
백링크 활용: 새 노트 작성 시 관련 기존 노트 자동 발견.
"연결되지 않은 노트"를 정기적으로 확인 → 고아 노트 방지.`,
    tags: ['obsidian', 'links', 'pkm'],
  },

  // === 건강/라이프스타일 ===
  {
    id: 'sleep-optimization',
    title: '수면 최적화',
    content: `수면 위생(Sleep Hygiene) 핵심 원칙:
1. 일정한 취침/기상 시간 (주말 포함)
2. 취침 2시간 전 블루라이트 차단
3. 침실 온도 18-20°C 유지
4. 카페인은 오후 2시 이전까지만
5. 매트리스와 베개 품질 투자
Sleep Cycle: 90분 주기 × 5-6회 = 7.5-9시간이 이상적.
낮잠은 20분 이하(power nap) 또는 90분(풀 사이클).`,
    tags: ['health', 'sleep', 'habits'],
  },
  {
    id: 'ergonomic-workspace',
    title: '인체공학적 작업 환경',
    content: `장시간 컴퓨터 작업을 위한 인체공학:
모니터: 눈높이에 팔 길이 거리. 상단 베젤이 눈높이.
키보드: 어깨 너비로 팔꿈치 90도. 손목 뉴트럴 포지션.
의자: 요추 지지, 허벅지 수평, 발바닥 바닥 완전 접촉.
20-20-20 규칙: 20분마다 20피트(6m) 거리를 20초간 응시.
스탠딩 데스크: 앉기/서기를 30분-1시간 간격으로 교대.`,
    tags: ['ergonomics', 'workspace', 'health'],
  },

  // === 경제/투자 ===
  {
    id: 'compound-interest',
    title: '복리의 마법',
    content: `복리는 이자에 이자가 붙는 효과로, 시간이 지날수록 기하급수적으로 성장한다.
72의 법칙: 72 ÷ 연수익률 = 자산이 2배가 되는 해 수.
연 7% 수익: 약 10년마다 자산 2배.
일찍 시작할수록 유리 — 10년 먼저 시작하면 최종 자산이 2배 이상.
매월 정액 적립(DCA)이 시장 타이밍보다 일관적으로 좋은 결과.`,
    tags: ['finance', 'investing', 'compound'],
  },
  {
    id: 'index-fund-strategy',
    title: '인덱스 펀드 투자 전략',
    content: `패시브 인덱스 투자가 대부분의 액티브 펀드를 이긴다 (S&P 500 기준 90%+).
핵심 포트폴리오: 글로벌 주식 ETF + 채권 ETF.
연령 기반 배분: 100 - 나이 = 주식 비중 (보수적 기준).
리밸런싱: 연 1-2회, 목표 비중으로 복원.
비용이 핵심: 운용보수 0.1% 이하 ETF 선택 (VOO, VTI, VXUS).`,
    tags: ['finance', 'investing', 'etf'],
  },

  // === 언어/커뮤니케이션 ===
  {
    id: 'technical-writing',
    title: '기술 문서 작성법',
    content: `좋은 기술 문서의 원칙:
1. 독자를 먼저 정의하라 (초보자? 전문가? 결정자?)
2. 결론을 먼저 — 역피라미드 구조
3. 한 단락 = 한 아이디어
4. 능동태 사용. "서버가 요청을 처리한다" (O), "요청이 처리된다" (X)
5. 코드 예시는 동작하는 최소 단위로
API 문서: 엔드포인트, 파라미터, 응답, 에러 코드를 빠짐없이.`,
    tags: ['writing', 'documentation', 'communication'],
  },
  {
    id: 'presentation-skills',
    title: '발표 기술',
    content: `효과적인 프레젠테이션:
구조: Hook → Problem → Solution → Evidence → Call to Action.
슬라이드: 한 장에 하나의 메시지. 텍스트보다 시각 자료.
전달: 3초 이상 청중과 눈 맞춤. 침묵을 두려워하지 마라.
Q&A 대비: 예상 질문 10개 준비. "좋은 질문입니다"로 시간 벌기.
리허설: 최소 3번. 녹화해서 자기 모습 확인.`,
    tags: ['presentation', 'communication', 'skills'],
  },

  // === 음식/요리 ===
  {
    id: 'meal-prep-basics',
    title: '일주일 식사 준비(Meal Prep)',
    content: `Meal Prep으로 시간/비용/건강을 동시에 챙길 수 있다.
일요일에 2-3시간 투자하면 평일 5일 점심/저녁 해결.
기본 구성: 단백질(닭가슴살, 달걀) + 탄수화물(현미, 고구마) + 채소.
보관: 유리 용기 추천. 냉장 3일, 냉동 1주.
소스/시즈닝을 바꿔가며 같은 재료도 다양하게 먹기.
시작 팁: 첫 주는 2가지 메뉴만. 익숙해지면 확장.`,
    tags: ['cooking', 'meal-prep', 'health'],
  },

  // === 철학/사고 ===
  {
    id: 'mental-models',
    title: '멘탈 모델 모음',
    content: `멘탈 모델은 세상을 이해하는 사고 프레임워크.
First Principles: 가정을 제거하고 기본 진실에서 추론.
Inversion: "어떻게 성공할까" 대신 "어떻게 실패할까"를 먼저 생각.
Pareto Principle (80/20): 20%의 노력이 80%의 결과를 만든다.
Occam's Razor: 가장 단순한 설명이 대체로 옳다.
Circle of Competence: 내가 진짜 아는 영역을 명확히 인식.`,
    tags: ['thinking', 'mental-models', 'philosophy'],
  },
  {
    id: 'decision-making-frameworks',
    title: '의사결정 프레임워크',
    content: `좋은 의사결정을 위한 도구:
Eisenhower Matrix: 긴급/중요 2×2 매트릭스로 우선순위.
RICE Scoring: Reach × Impact × Confidence / Effort.
Reversibility Test: 되돌릴 수 있는 결정은 빠르게, 없는 결정은 신중히.
Regret Minimization: 80세의 나는 이 결정을 후회할까?
Pre-mortem: 프로젝트 시작 전 "실패했다면 왜?"를 상상.`,
    tags: ['decision-making', 'frameworks', 'thinking'],
  },

  // === 추가: 의미적 관련성 테스트용 ===
  {
    id: 'burnout-prevention',
    title: '번아웃 예방',
    content: `번아웃은 만성적 업무 스트레스로 인한 에너지 고갈 상태.
증상: 냉소적 태도, 업무 효능감 저하, 신체적 피로.
예방: 명확한 업무 경계 설정. "아니오"라고 말하는 연습.
회복: 완전한 디지털 디톡스, 자연 속 산책, 수면 우선.
조직 차원: 자율성 부여, 성취 인정, 과도한 야근 문화 개선.`,
    tags: ['mental-health', 'burnout', 'work-life'],
  },
  {
    id: 'focus-techniques',
    title: '집중력 향상 기법들',
    content: `현대인의 집중력은 평균 8초라는 연구도 있다.
환경 설정: 스마트폰을 다른 방에. 알림 전부 끄기.
시간 블록: 하루를 30분-2시간 블록으로 나눠 배정.
Flow State 진입: 도전 수준 = 실력 수준일 때 몰입 발생.
Mind wandering 인식: 생각이 새면 알아차리고 돌아오는 것이 훈련.
명상(특히 마음챙김)이 주의력 지속 시간을 증가시킨다는 연구 다수.`,
    tags: ['focus', 'productivity', 'mindfulness'],
  },
  {
    id: 'knowledge-graph-obsidian',
    title: 'Obsidian 지식 그래프 활용',
    content: `Obsidian의 그래프 뷰는 노트 간 연결을 시각화한다.
잘 연결된 노트일수록 그래프 중심부에 위치 — 핵심 지식.
고립된 노트(orphan)는 연결 기회를 놓친 것 — 정기 리뷰 대상.
그래프에서 클러스터가 보이면 MOC(Map of Content) 생성 기회.
Local Graph: 현재 노트의 1-2홉 이웃만 보여줌 — 관련 노트 탐색에 유용.
너무 많은 링크도 문제 — 의미 있는 연결만 생성.`,
    tags: ['obsidian', 'graph', 'pkm'],
  },
  {
    id: 'spaced-repetition',
    title: '간격 반복(Spaced Repetition)',
    content: `Ebbinghaus의 망각 곡선: 학습 후 시간이 지나면 기억이 급격히 감소.
간격 반복은 망각 직전에 복습하여 기억을 강화하는 기법.
Anki: 가장 유명한 SRS(Spaced Repetition System) 앱.
Obsidian에서는 Spaced Repetition 플러그인으로 노트를 플래시카드화.
최적 간격: 1일 → 3일 → 7일 → 14일 → 30일 → 90일.
능동적 회상(Active Recall)과 결합하면 효과 극대화.`,
    tags: ['learning', 'memory', 'spaced-repetition'],
  },
  {
    id: 'semantic-search-explained',
    title: '시맨틱 검색이란',
    content: `전통적 키워드 검색(BM25)은 단어 일치에 의존한다.
시맨틱 검색은 의미를 이해하여 관련 문서를 찾는다.
원리: 쿼리와 문서를 같은 벡터 공간에 임베딩 → 코사인 유사도로 순위.
장점: "강아지 훈련"으로 "반려견 교육" 문서도 검색 가능.
단점: 정확한 키워드 매칭에는 BM25가 여전히 우수.
최적 전략: BM25 + 시맨틱을 결합한 하이브리드 검색.`,
    tags: ['search', 'semantic', 'nlp'],
  },
  {
    id: 'obsidian-automation',
    title: 'Obsidian 자동화 도구',
    content: `QuickAdd: 커스텀 캡처 프로세스. 템플릿 + 입력폼 조합.
Periodic Notes: Daily/Weekly/Monthly/Yearly 노트 자동 생성.
Linter: 마크다운 포맷 자동 정리 (YAML, 헤딩, 공백 등).
Tasks: 전체 vault에서 할 일 항목을 수집/필터/정렬.
Knowledge Maintenance(Noluma): AI 기반 태그/분류 + 유지보수 자동화.
자동화의 목표: 반복 작업을 줄여 "생각"에만 집중하기.`,
    tags: ['obsidian', 'automation', 'plugins'],
  },
  {
    id: 'information-overload',
    title: '정보 과부하 대처법',
    content: `현대인은 매일 34GB의 정보에 노출된다는 추정.
대처법 1: 인풋 소스를 5개 이하로 제한 (RSS, 뉴스레터 큐레이션).
대처법 2: 2분 룰 — 2분 안에 처리 가능하면 즉시, 아니면 Inbox에 넣기.
대처법 3: Progressive Summarization으로 핵심만 추출.
대처법 4: 주간 리뷰에서 미처리 항목을 삭제하거나 보관.
정보를 "모으는 것"이 아니라 "행동으로 연결하는 것"이 목표.`,
    tags: ['productivity', 'information', 'pkm'],
  },
  {
    id: 'creative-thinking',
    title: '창의적 사고 기법',
    content: `창의성은 타고나는 것이 아니라 훈련할 수 있다.
SCAMPER: Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse.
무작위 자극: 관련 없는 단어/이미지에서 연상하여 새로운 아이디어 생성.
Constraint-based creativity: 제약이 오히려 창의성을 높인다.
Incubation: 의식적 노력을 멈추면 무의식이 배경에서 연결을 만든다.
다양한 분야의 지식을 연결하는 것이 진정한 창의성.`,
    tags: ['creativity', 'thinking', 'innovation'],
  },
  {
    id: 'obsidian-maintenance-workflow',
    title: 'Obsidian vault 유지보수 루틴',
    content: `vault가 커지면 정기적 유지보수가 필수.
주간: 고아 노트(연결 없는 노트) 확인. 링크 추가하거나 병합.
월간: 태그 정리. 사용되지 않는 태그 제거, 유사 태그 통합.
분기: 폴더 구조 검토. 비대해진 폴더는 하위 분류.
깨진 링크: 노트 이동/삭제 시 발생. 정기적으로 스캔 필요.
자동화: Knowledge Maintenance 플러그인이 이 작업을 AI로 대행.`,
    tags: ['obsidian', 'maintenance', 'workflow'],
  },
  {
    id: 'reading-effectively',
    title: '효과적인 독서법',
    content: `목적 있는 읽기: 왜 이 책을 읽는지 먼저 명확히 한다.
SQ3R: Survey(훑어보기), Question(질문), Read, Recite(복기), Review.
마진 노트: 책에 직접 밑줄/메모 (종이책) 또는 하이라이트 (e-book).
독서 노트: 핵심 주장 3가지 + 나의 생각 + 실행 항목.
모든 책을 끝까지 읽을 필요 없다 — 가치 없으면 버려도 된다.
인풋(읽기)과 아웃풋(쓰기, 실행)의 비율을 1:1에 가깝게.`,
    tags: ['reading', 'learning', 'pkm'],
  },
  {
    id: 'microservices-vs-monolith',
    title: '마이크로서비스 vs 모놀리스',
    content: `모놀리스: 단일 배포 단위. 작은 팀에 적합. 디버깅/배포 단순.
마이크로서비스: 독립 배포/스케일링. 팀 자율성. 복잡도 비용 높음.
전환 시점: 모놀리스가 "too big to deploy"가 될 때.
Strangler Fig 패턴: 점진적으로 모놀리스에서 서비스를 떼어냄.
경고: 3-5인 팀이 처음부터 마이크로서비스는 over-engineering.
분산 시스템의 8가지 오류(Fallacies)를 숙지할 것.`,
    tags: ['architecture', 'microservices', 'design'],
  },
  {
    id: 'code-review-best-practices',
    title: '코드 리뷰 모범 사례',
    content: `코드 리뷰의 목적: 버그 발견보다 지식 공유와 코드 일관성.
리뷰어: PR 크기 400줄 이하 유지 요청. 큰 PR은 의미 단위로 분리.
피드백: "왜"를 설명. "이렇게 하면 X 문제가 생길 수 있어요" 형식.
Nitpick 표시: 취향 차이는 [nit]으로 표시. 블로킹하지 않음.
셀프 리뷰: PR 올리기 전 자기 코드를 먼저 리뷰.
비동기 리뷰가 기본. 복잡한 건 페어링으로 전환.`,
    tags: ['code-review', 'collaboration', 'engineering'],
  },
  {
    id: 'async-communication',
    title: '비동기 커뮤니케이션 원칙',
    content: `비동기 우선: 대부분의 업무 소통은 실시간이 아니어도 된다.
글 쓰기 원칙: 상대방이 추가 질문 없이 행동할 수 있도록 충분한 컨텍스트.
응답 기대 시간 명시: "[오늘까지]", "[급하지 않음]" 등.
회의 최소화: 문서로 대체할 수 있으면 회의 취소.
Decision Log: 슬랙/이메일에서 결정된 내용을 문서화.
시차 근무 팀일수록 비동기 문화가 필수.`,
    tags: ['communication', 'async', 'remote-work'],
  },
  {
    id: 'learning-to-learn',
    title: '학습법의 학습(메타 학습)',
    content: `효과적 학습의 3대 원칙:
1. Active Recall: 읽기/보기보다 스스로 떠올리기가 5배 효과적.
2. Spaced Repetition: 망각 직전에 복습하여 장기 기억화.
3. Interleaving: 한 주제만 집중하지 말고 관련 주제를 섞어 학습.
Feynman Technique: 초등학생에게 설명하듯 단순화. 막히면 다시 공부.
학습 환경: 시험 조건과 유사한 환경에서 연습(Context-Dependent Memory).`,
    tags: ['learning', 'meta-learning', 'education'],
  },
];

// ─── 20 Golden Queries (Easy / Medium / Hard) ───
export const GOLDEN_QUERIES: GoldenQuery[] = [
  // === Easy (키워드 직접 매칭 — BM25도 잘 찾음) ===
  {
    id: 'q01-react-hooks',
    query: 'React Hooks useState useEffect 사용법',
    relevant: ['react-hooks-guide', 'react-state-management'],
    difficulty: 'easy',
    description: '키워드(hooks, useState)가 문서에 직접 등장',
  },
  {
    id: 'q02-docker-build',
    query: 'Docker 멀티스테이지 빌드로 이미지 크기 줄이기',
    relevant: ['docker-multi-stage'],
    difficulty: 'easy',
    description: '제목과 내용에 키워드 직접 일치',
  },
  {
    id: 'q03-obsidian-plugin',
    query: 'Obsidian 플러그인 개발 방법 TypeScript',
    relevant: ['obsidian-plugin-development'],
    difficulty: 'easy',
    description: '키워드 완전 일치',
  },
  {
    id: 'q04-vector-db',
    query: '벡터 데이터베이스 비교 Pinecone Weaviate',
    relevant: ['vector-database-choices'],
    difficulty: 'easy',
    description: '고유 키워드(Pinecone, Weaviate) 매칭',
  },
  {
    id: 'q05-git-flow',
    query: 'Git 브랜칭 전략 비교 GitFlow GitHub Flow',
    relevant: ['git-workflow-comparison'],
    difficulty: 'easy',
    description: '키워드 매칭',
  },

  // === Medium (패러프레이즈/동의어 — BM25 약, embedding 강) ===
  {
    id: 'q06-concentration',
    query: '일할 때 집중력을 높이는 방법',
    relevant: ['focus-techniques', 'deep-work-rules', 'pomodoro-technique'],
    difficulty: 'medium',
    description: '"집중력"이라는 단어는 있지만, "deep work"나 "pomodoro"와의 연결은 의미적',
  },
  {
    id: 'q07-note-connections',
    query: '메모 간 연결을 만드는 좋은 방법',
    relevant: ['obsidian-linking-strategy', 'zettelkasten-method', 'knowledge-graph-obsidian'],
    difficulty: 'medium',
    description: '"메모 연결"은 linking/zettelkasten의 패러프레이즈',
  },
  {
    id: 'q08-ai-search',
    query: 'AI로 관련 문서를 찾는 방법',
    relevant: ['semantic-search-explained', 'rag-pipeline', 'embedding-models-comparison'],
    difficulty: 'medium',
    description: '"AI로 문서 찾기"는 시맨틱 검색/RAG의 상위 표현',
  },
  {
    id: 'q09-software-structure',
    query: '소프트웨어 구조를 깔끔하게 나누는 원칙',
    relevant: ['clean-architecture-principles', 'microservices-vs-monolith'],
    difficulty: 'medium',
    description: '"구조를 깔끔하게"는 clean architecture의 비기술적 표현',
  },
  {
    id: 'q10-money-growth',
    query: '돈을 장기적으로 불리는 전략',
    relevant: ['compound-interest', 'index-fund-strategy'],
    difficulty: 'medium',
    description: '"돈을 불리다"는 투자/복리의 일상 표현',
  },
  {
    id: 'q11-forget-less',
    query: '공부한 내용을 덜 잊는 방법',
    relevant: ['spaced-repetition', 'learning-to-learn'],
    difficulty: 'medium',
    description: '"덜 잊기"는 간격반복/메타학습의 패러프레이즈',
  },
  {
    id: 'q12-vault-cleanup',
    query: 'Obsidian vault가 지저분해졌을 때 정리법',
    relevant: ['obsidian-maintenance-workflow', 'obsidian-tag-strategy', 'obsidian-automation'],
    difficulty: 'medium',
    description: '"지저분해졌을 때 정리"는 maintenance의 일상적 표현',
  },

  // === Hard (주제적 관련성만 — embedding만 찾을 수 있음) ===
  {
    id: 'q13-avoid-exhaustion',
    query: '업무로 인한 탈진을 피하려면',
    relevant: ['burnout-prevention', 'deep-work-rules', 'sleep-optimization'],
    difficulty: 'hard',
    description: '"탈진"은 burnout의 동의어이나, deep-work/sleep과의 연결은 순수 의미적',
  },
  {
    id: 'q14-think-better',
    query: '더 나은 판단을 내리고 싶다',
    relevant: ['mental-models', 'decision-making-frameworks'],
    difficulty: 'hard',
    description: '"판단"을 "decision-making"이나 "mental models"로 연결하는 것은 고수준 의미 추론',
  },
  {
    id: 'q15-remote-team',
    query: '원격 팀에서 효과적으로 협업하는 법',
    relevant: ['async-communication', 'code-review-best-practices'],
    difficulty: 'hard',
    description: '"원격 협업"에서 async communication과 코드 리뷰를 연결하는 것은 주제적 추론',
  },
  {
    id: 'q16-personal-knowledge',
    query: '내가 배운 것을 체계적으로 관리하고 싶다',
    relevant: ['second-brain-building', 'zettelkasten-method', 'obsidian-daily-notes'],
    difficulty: 'hard',
    description: '매우 추상적 질의. 키워드 없이 PKM 전체 도메인에 매핑',
  },
  {
    id: 'q17-llm-context',
    query: 'LLM에게 외부 지식을 제공하는 아키텍처',
    relevant: ['rag-pipeline', 'semantic-search-explained', 'embedding-models-comparison'],
    difficulty: 'hard',
    description: '"외부 지식 제공"은 RAG의 추상적 서술. 키워드 "RAG"는 쿼리에 없음',
  },
  {
    id: 'q18-workspace-health',
    query: '오래 앉아서 일할 때 몸에 좋은 환경 만들기',
    relevant: ['ergonomic-workspace', 'sleep-optimization'],
    difficulty: 'hard',
    description: '"몸에 좋은 환경"은 ergonomics의 비기술적 표현',
  },
  {
    id: 'q19-obsidian-ai-features',
    query: 'Obsidian에서 AI가 도와줄 수 있는 것들',
    relevant: ['obsidian-automation', 'obsidian-maintenance-workflow', 'semantic-search-explained'],
    difficulty: 'hard',
    description: 'AI + Obsidian 교차 주제. 직접 키워드 매칭 없이 주제 추론 필요',
  },
  {
    id: 'q20-new-ideas',
    query: '새로운 아이디어를 떠올리는 방법',
    relevant: ['creative-thinking', 'mental-models', 'zettelkasten-method'],
    difficulty: 'hard',
    description: '"아이디어"에서 creativity/zettelkasten 연결은 순수 의미적',
  },
];

// ─── Scoring Utilities ───

export function precisionAtK(retrieved: string[], relevant: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  const hits = topK.filter(id => relevant.includes(id)).length;
  return hits / k;
}

export function recallAtK(retrieved: string[], relevant: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  const hits = topK.filter(id => relevant.includes(id)).length;
  return relevant.length === 0 ? 0 : hits / relevant.length;
}

export function mrr(retrieved: string[], relevant: string[]): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.includes(retrieved[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function averageMetrics(results: BenchmarkResult[]): {
  avgPrecisionAt3: number;
  avgPrecisionAt5: number;
  avgRecallAt3: number;
  avgRecallAt5: number;
  avgMrr: number;
} {
  const n = results.length;
  if (n === 0) return { avgPrecisionAt3: 0, avgPrecisionAt5: 0, avgRecallAt3: 0, avgRecallAt5: 0, avgMrr: 0 };
  return {
    avgPrecisionAt3: results.reduce((s, r) => s + r.precisionAt3, 0) / n,
    avgPrecisionAt5: results.reduce((s, r) => s + r.precisionAt5, 0) / n,
    avgRecallAt3: results.reduce((s, r) => s + r.recallAt3, 0) / n,
    avgRecallAt5: results.reduce((s, r) => s + r.recallAt5, 0) / n,
    avgMrr: results.reduce((s, r) => s + r.mrr, 0) / n,
  };
}
