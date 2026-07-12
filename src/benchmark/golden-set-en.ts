/**
 * English Golden Set: Embedding benchmark dataset for English-language notes
 *
 * 53 documents + 20 queries covering diverse personal knowledge vault topics.
 * Designed to complement the Korean golden set (golden-set.ts) for bilingual evaluation.
 */

import type { GoldenDocument, GoldenQuery } from './golden-set';

// ─── 53 English Golden Documents ───
export const GOLDEN_DOCUMENTS_EN: GoldenDocument[] = [
  // === Programming / Tech (15 docs) ===
  {
    id: 'python-design-patterns',
    title: 'Python Design Patterns',
    content: `Design patterns in Python leverage the language's dynamic nature and first-class functions.
The Strategy pattern can be implemented with simple callables instead of class hierarchies.
Decorators naturally express the Decorator pattern, wrapping behavior around functions or methods.
The Factory pattern uses classmethods or module-level functions to create objects polymorphically.
Python's duck typing reduces the need for explicit interfaces but protocols (PEP 544) add structural subtyping.`,
    tags: ['python', 'design-patterns', 'software-engineering'],
  },
  {
    id: 'rust-ownership-model',
    title: 'Rust Ownership and Borrowing',
    content: `Rust's ownership system ensures memory safety without a garbage collector at compile time.
Each value has exactly one owner, and when the owner goes out of scope the value is dropped.
Borrowing allows references to data without taking ownership — either one mutable or many immutable references.
Lifetimes are annotations that tell the compiler how long references remain valid.
This system eliminates data races, use-after-free, and double-free bugs entirely at compile time.`,
    tags: ['rust', 'memory-safety', 'ownership'],
  },
  {
    id: 'graphql-fundamentals',
    title: 'GraphQL API Design Fundamentals',
    content: `GraphQL provides a single endpoint where clients specify exactly the data they need via queries.
Unlike REST, clients avoid over-fetching and under-fetching by declaring the shape of the response.
Mutations handle writes, and subscriptions enable real-time data via WebSocket connections.
Schema-first design defines types, queries, and mutations before implementing resolvers.
N+1 query problems are solved with DataLoader, which batches and caches database lookups per request.`,
    tags: ['graphql', 'api', 'backend'],
  },
  {
    id: 'webassembly-overview',
    title: 'WebAssembly: Near-Native Performance in the Browser',
    content: `WebAssembly (Wasm) is a binary instruction format that runs alongside JavaScript in browsers.
It delivers near-native execution speed for compute-intensive tasks like image processing and physics engines.
Languages like Rust, C++, and Go can compile to Wasm, enabling code reuse across platforms.
WASI (WebAssembly System Interface) extends Wasm beyond browsers to server-side and edge computing.
The component model allows composing Wasm modules from different languages into a single application.`,
    tags: ['webassembly', 'performance', 'browser'],
  },
  {
    id: 'kubernetes-core-concepts',
    title: 'Kubernetes Core Concepts',
    content: `Kubernetes orchestrates containerized workloads across a cluster of nodes with declarative configuration.
Pods are the smallest deployable units, typically containing one main container plus optional sidecars.
Services provide stable networking endpoints and load balancing across pod replicas.
Deployments manage rolling updates and rollbacks, ensuring zero-downtime releases.
ConfigMaps and Secrets separate configuration from container images, following twelve-factor principles.`,
    tags: ['kubernetes', 'containers', 'devops'],
  },
  {
    id: 'cicd-pipeline-design',
    title: 'CI/CD Pipeline Design Principles',
    content: `Continuous Integration means merging code frequently with automated builds and tests on every push.
Continuous Delivery extends CI by ensuring the codebase is always in a deployable state.
Pipeline stages typically flow: lint → unit test → build → integration test → deploy to staging → production.
Fast feedback loops are critical — tests should run in under 10 minutes to avoid context switching.
Infrastructure as Code (Terraform, Pulumi) makes environments reproducible and pipelines deterministic.`,
    tags: ['cicd', 'devops', 'automation'],
  },
  {
    id: 'gang-of-four-patterns',
    title: 'Gang of Four Design Patterns Summary',
    content: `The 23 GoF patterns divide into Creational, Structural, and Behavioral categories.
Creational patterns (Factory, Builder, Singleton) abstract object instantiation logic.
Structural patterns (Adapter, Composite, Proxy) compose objects into larger structures.
Behavioral patterns (Observer, Strategy, Command) define communication between objects.
Modern languages often replace patterns with built-in features — closures replace Strategy, iterators replace Iterator.`,
    tags: ['design-patterns', 'oop', 'architecture'],
  },
  {
    id: 'functional-programming-principles',
    title: 'Functional Programming Core Principles',
    content: `Functional programming treats computation as evaluation of mathematical functions without side effects.
Pure functions always return the same output for the same input and have no observable side effects.
Immutability means data structures are never modified — new versions are created instead.
Higher-order functions accept or return other functions, enabling composition and abstraction.
Monads encapsulate effects (IO, errors, async) while maintaining referential transparency in the type system.`,
    tags: ['functional-programming', 'immutability', 'pure-functions'],
  },
  {
    id: 'machine-learning-basics',
    title: 'Machine Learning Fundamentals',
    content: `Machine learning algorithms learn patterns from data rather than being explicitly programmed with rules.
Supervised learning trains on labeled data to predict outputs — classification or regression tasks.
Unsupervised learning discovers hidden structure in unlabeled data via clustering or dimensionality reduction.
Overfitting occurs when a model memorizes training data instead of learning generalizable patterns.
The bias-variance tradeoff is central: too simple models underfit, too complex models overfit.`,
    tags: ['machine-learning', 'ai', 'data-science'],
  },
  {
    id: 'data-structures-tradeoffs',
    title: 'Data Structures and Their Tradeoffs',
    content: `Hash maps provide O(1) average lookup but degrade to O(n) with poor hash functions or high collision rates.
Balanced BSTs (Red-Black, AVL) guarantee O(log n) operations and maintain sorted order for range queries.
Arrays offer cache-friendly sequential access but O(n) insertion; linked lists offer O(1) insertion but poor locality.
Tries excel at prefix matching and autocomplete with O(k) lookup where k is key length.
Choosing the right structure depends on access patterns, memory constraints, and whether data is sorted.`,
    tags: ['data-structures', 'algorithms', 'performance'],
  },
  {
    id: 'system-design-scalability',
    title: 'System Design: Scalability Patterns',
    content: `Horizontal scaling adds more machines while vertical scaling adds more power to existing machines.
Load balancers distribute traffic across servers using round-robin, least-connections, or consistent hashing.
Caching layers (Redis, Memcached) reduce database load by storing frequently accessed data in memory.
Database sharding partitions data across multiple instances based on a shard key for write scalability.
Event-driven architecture with message queues (Kafka, RabbitMQ) decouples services and handles traffic spikes.`,
    tags: ['system-design', 'scalability', 'distributed-systems'],
  },
  {
    id: 'oauth-authentication-flows',
    title: 'OAuth 2.0 and Authentication Patterns',
    content: `OAuth 2.0 is an authorization framework that grants third-party apps limited access without sharing credentials.
The Authorization Code flow with PKCE is recommended for public clients like SPAs and mobile apps.
Access tokens are short-lived (minutes to hours); refresh tokens are long-lived and stored securely.
OpenID Connect adds an identity layer on top of OAuth 2.0 for authentication via ID tokens (JWTs).
Token storage matters: httpOnly cookies prevent XSS theft, while localStorage is vulnerable to script injection.`,
    tags: ['oauth', 'authentication', 'security'],
  },
  {
    id: 'websocket-realtime-patterns',
    title: 'WebSocket and Real-Time Communication',
    content: `WebSocket provides full-duplex communication over a single TCP connection, unlike HTTP's request-response model.
The handshake upgrades an HTTP connection, then both client and server can push messages independently.
Heartbeat pings detect dead connections; automatic reconnection with exponential backoff handles network drops.
Server-Sent Events (SSE) is a simpler one-way alternative when the server only needs to push updates.
Scaling WebSocket requires sticky sessions or a pub/sub layer (Redis) to broadcast across multiple server instances.`,
    tags: ['websocket', 'realtime', 'networking'],
  },
  {
    id: 'microservices-architecture',
    title: 'Microservices Architecture Principles',
    content: `Microservices decompose a monolith into independently deployable services organized around business capabilities.
Each service owns its data store (database per service) to achieve loose coupling and independent scaling.
Inter-service communication uses synchronous REST/gRPC for queries and async events for commands/notifications.
The Saga pattern coordinates distributed transactions across services using compensating actions on failure.
Service mesh (Istio, Linkerd) handles cross-cutting concerns: mTLS, retries, circuit breaking, observability.`,
    tags: ['microservices', 'architecture', 'distributed-systems'],
  },
  {
    id: 'testing-strategies-comprehensive',
    title: 'Comprehensive Testing Strategies',
    content: `Property-based testing generates random inputs to discover edge cases that example-based tests miss.
Contract testing (Pact) verifies API compatibility between services without running full integration suites.
Mutation testing modifies source code to check whether tests detect the changes — measuring test quality.
Snapshot testing captures component output and alerts on unintended changes, useful for UI regression.
Chaos engineering (Netflix's Chaos Monkey) intentionally introduces failures to verify system resilience.`,
    tags: ['testing', 'quality-assurance', 'reliability'],
  },

  // === Productivity / PKM (12 docs) ===
  {
    id: 'gtd-methodology',
    title: 'Getting Things Done (GTD) Methodology',
    content: `GTD is David Allen's five-step workflow: Capture, Clarify, Organize, Reflect, and Engage.
The core insight is that your mind is for having ideas, not holding them — externalize everything.
The two-minute rule: if a task takes less than two minutes, do it immediately rather than filing it.
Weekly review is the keystone habit — process inboxes, update project lists, and plan the upcoming week.
Context-based lists (@computer, @phone, @errands) help choose actions based on current tools and energy.`,
    tags: ['gtd', 'productivity', 'task-management'],
  },
  {
    id: 'atomic-habits-framework',
    title: 'Atomic Habits Framework',
    content: `James Clear's framework focuses on 1% improvements that compound into remarkable results over time.
The four laws of behavior change: make it obvious, attractive, easy, and satisfying.
Habit stacking links a new habit to an existing one: "After [current habit], I will [new habit]."
Identity-based habits focus on who you want to become rather than what you want to achieve.
Environment design is more powerful than willpower — reduce friction for good habits, increase it for bad ones.`,
    tags: ['habits', 'behavior-change', 'self-improvement'],
  },
  {
    id: 'zettelkasten-english',
    title: 'The Zettelkasten Method for Knowledge Work',
    content: `The Zettelkasten (slip-box) method creates a network of atomic, interconnected notes that grows organically.
Each note captures one idea in your own words with a unique identifier and explicit links to related notes.
The three note types: fleeting (quick captures), literature (source summaries), and permanent (your own thinking).
Unlike hierarchical folders, the emergent structure reveals unexpected connections between distant ideas.
Regular review of link clusters surfaces new insights and writing topics from your accumulated knowledge.`,
    tags: ['zettelkasten', 'pkm', 'knowledge-management'],
  },
  {
    id: 'morning-routines-research',
    title: 'Morning Routines Backed by Research',
    content: `Consistent wake times regulate circadian rhythm more effectively than consistent sleep duration alone.
Exposure to bright light within 30 minutes of waking suppresses melatonin and boosts alertness for hours.
Delaying caffeine 90-120 minutes after waking allows cortisol to peak naturally, improving sustained energy.
A brief movement session (even 10 minutes of walking) increases BDNF and primes the brain for focused work.
Journaling or intention-setting in the morning leverages the brain's prefrontal cortex peak in early hours.`,
    tags: ['morning-routine', 'habits', 'health'],
  },
  {
    id: 'time-blocking-method',
    title: 'Time Blocking for Deep Productivity',
    content: `Time blocking assigns every hour of the day to a specific task or category, eliminating decision fatigue.
Cal Newport advocates batching shallow work (email, admin) into defined blocks to protect deep work hours.
The ideal deep work block is 90-120 minutes, matching the brain's ultradian rhythm cycle.
Buffer blocks between meetings prevent schedule compression and allow transitions between contexts.
Reviewing yesterday's time blocks against actual activity reveals where attention leaks occur.`,
    tags: ['time-blocking', 'productivity', 'deep-work'],
  },
  {
    id: 'note-taking-frameworks',
    title: 'Note-Taking Frameworks Compared',
    content: `Cornell Method divides the page into cues, notes, and summary — forcing active recall during review.
Outline Method creates hierarchical bullet points, best for structured lectures with clear organization.
Mind mapping works visually from a central concept outward, ideal for brainstorming and creative exploration.
Progressive Summarization highlights key passages across multiple passes, each layer more distilled.
The best method depends on context: capturing (speed matters) vs. processing (understanding matters).`,
    tags: ['note-taking', 'learning', 'pkm'],
  },
  {
    id: 'para-method-organizing',
    title: 'The PARA Method for Organizing Digital Information',
    content: `PARA divides all information into four categories: Projects, Areas, Resources, and Archives.
Projects are short-term efforts with a deadline — they have clear completion criteria.
Areas are ongoing responsibilities with standards to maintain (health, finances, career development).
Resources are topics of interest that may be useful in the future but have no deadline.
Archives store inactive items from the other three categories, keeping the active workspace uncluttered.`,
    tags: ['para', 'organization', 'pkm'],
  },
  {
    id: 'digital-minimalism',
    title: 'Digital Minimalism Philosophy',
    content: `Cal Newport's Digital Minimalism argues that less technology, carefully chosen, yields more satisfaction.
The philosophy: use technology only when it strongly supports something you deeply value.
A 30-day digital declutter removes all optional tech, then selectively reintroduces what passes a strict test.
Attention is a finite resource — every app notification fragments it, reducing capacity for deep thought.
Solitude deprivation (never being alone with your thoughts) is a modern epidemic that erodes creativity and self-knowledge.`,
    tags: ['digital-minimalism', 'attention', 'technology'],
  },
  {
    id: 'flow-state-psychology',
    title: 'The Psychology of Flow States',
    content: `Mihaly Csikszentmihalyi's flow state is complete absorption in a task where time perception distorts.
Flow requires a balance between skill level and challenge — too easy causes boredom, too hard causes anxiety.
Clear goals, immediate feedback, and a sense of control are environmental prerequisites for flow.
The autotelic personality trait correlates with more frequent flow experiences across diverse activities.
Distractions are the primary enemy of flow — it takes approximately 23 minutes to fully re-enter a flow state after interruption.`,
    tags: ['flow', 'psychology', 'focus'],
  },
  {
    id: 'journaling-practices',
    title: 'Evidence-Based Journaling Practices',
    content: `Expressive writing (Pennebaker method) about emotional events for 15-20 minutes improves physical health outcomes.
Gratitude journaling (three good things) increases well-being and reduces depressive symptoms within two weeks.
Bullet journaling combines rapid logging with monthly migration to surface what truly matters from the noise.
Reflective journaling after decisions creates a personal feedback loop, improving future judgment calibration.
Morning pages (three pages of stream-of-consciousness) clear mental clutter and unlock creative thinking.`,
    tags: ['journaling', 'mental-health', 'self-reflection'],
  },
  {
    id: 'mind-mapping-techniques',
    title: 'Mind Mapping for Creative Thinking',
    content: `Mind maps start with a central concept and branch outward using keywords, colors, and spatial arrangement.
Tony Buzan's rules: use images, curved lines, one word per branch, and multiple colors to engage both hemispheres.
Mind maps activate radiant thinking — the brain's natural associative pattern — unlike linear note-taking.
Software tools (Miro, Excalidraw) enable collaborative mind mapping but paper retains tactile engagement benefits.
Best applications: brainstorming, planning presentations, summarizing books, and exploring problem spaces.`,
    tags: ['mind-mapping', 'creativity', 'thinking-tools'],
  },
  {
    id: 'weekly-review-practice',
    title: 'The Weekly Review: Keystone Productivity Habit',
    content: `The weekly review is a dedicated session (60-90 minutes) to get current, get clear, and get creative.
Step 1: Process all inboxes to zero — email, notes, physical desk, browser tabs, messaging apps.
Step 2: Review active projects and next actions, updating status and removing completed items.
Step 3: Review calendar (past week for loose ends, next two weeks for preparation needed).
Step 4: Identify the 3-5 most important outcomes for the upcoming week and schedule them.`,
    tags: ['weekly-review', 'gtd', 'productivity'],
  },

  // === Science / Health (8 docs) ===
  {
    id: 'sleep-science-fundamentals',
    title: 'Sleep Science Fundamentals',
    content: `Sleep cycles through NREM stages 1-3 (light to deep) and REM in approximately 90-minute cycles.
Deep sleep (NREM Stage 3) is critical for physical repair, immune function, and memory consolidation.
REM sleep processes emotional memories and enables creative problem-solving through novel neural connections.
Sleep deprivation impairs cognitive function equivalently to alcohol intoxication after 24 hours awake.
Consistent sleep schedules (even on weekends) strengthen circadian entrainment more than total hours slept.`,
    tags: ['sleep', 'neuroscience', 'health'],
  },
  {
    id: 'nutrition-fundamentals',
    title: 'Nutrition Science Basics',
    content: `Macronutrients (protein, carbohydrates, fats) provide energy; micronutrients (vitamins, minerals) enable metabolic processes.
Protein intake of 1.6-2.2g per kg of body weight optimizes muscle protein synthesis for active individuals.
Ultra-processed foods are associated with inflammation, gut dysbiosis, and overeating due to blunted satiety signals.
Fiber (25-35g daily) feeds beneficial gut bacteria, regulates blood sugar, and supports cardiovascular health.
Nutrient timing matters less than total daily intake for most goals — consistency beats optimization for beginners.`,
    tags: ['nutrition', 'health', 'diet'],
  },
  {
    id: 'exercise-science-principles',
    title: 'Exercise Science: Key Principles',
    content: `Progressive overload — gradually increasing weight, volume, or intensity — drives adaptation in all training modalities.
Resistance training preserves muscle mass during aging (sarcopenia prevention) and increases resting metabolic rate.
Zone 2 cardio (conversational pace) builds mitochondrial density and aerobic base without excessive cortisol.
Recovery is when adaptation occurs — overtraining syndrome results from insufficient rest between stress loads.
Minimum effective dose for health benefits: 150 minutes moderate or 75 minutes vigorous activity per week.`,
    tags: ['exercise', 'fitness', 'health'],
  },
  {
    id: 'neuroplasticity-learning',
    title: 'Neuroplasticity and Learning',
    content: `Neuroplasticity is the brain's ability to reorganize neural connections in response to experience throughout life.
Deliberate practice (focused, effortful repetition at the edge of ability) drives the most structural change.
Sleep consolidates learning by replaying neural patterns and pruning weak synapses (synaptic homeostasis hypothesis).
Novel environments and challenging tasks upregulate BDNF, which promotes neuron growth and synaptic strengthening.
The critical period hypothesis has been revised — adults retain significant plasticity, though learning requires more effort.`,
    tags: ['neuroplasticity', 'brain', 'learning'],
  },
  {
    id: 'cognitive-biases-overview',
    title: 'Cognitive Biases That Distort Thinking',
    content: `Confirmation bias leads us to seek, interpret, and remember information that confirms existing beliefs.
Anchoring bias causes over-reliance on the first piece of information encountered when making decisions.
The availability heuristic judges probability by how easily examples come to mind, skewing toward vivid events.
Dunning-Kruger effect: low competence correlates with overconfidence; high competence with underestimation.
Survivorship bias focuses on successes while ignoring the (often larger) pool of failures, distorting conclusions.`,
    tags: ['cognitive-biases', 'psychology', 'decision-making'],
  },
  {
    id: 'meditation-research',
    title: 'Meditation: What the Research Shows',
    content: `Mindfulness meditation reduces cortisol levels and amygdala reactivity after 8 weeks of consistent practice.
Meta-analyses show moderate effect sizes for anxiety and depression, comparable to antidepressant medication.
Focused-attention meditation (on breath) trains sustained concentration; open-monitoring cultivates awareness without judgment.
Long-term practitioners show increased cortical thickness in regions associated with attention and interoception.
Even brief daily sessions (10 minutes) improve working memory and emotional regulation in randomized trials.`,
    tags: ['meditation', 'mindfulness', 'mental-health'],
  },
  {
    id: 'circadian-rhythm-biology',
    title: 'Circadian Rhythm Biology',
    content: `The suprachiasmatic nucleus (SCN) in the hypothalamus acts as the master clock, synchronized by light exposure.
Every cell contains clock genes that regulate metabolic processes in approximately 24-hour cycles.
Circadian misalignment (shift work, jet lag) increases risk of metabolic syndrome, cardiovascular disease, and cancer.
Morning light exposure advances the clock (earlier sleep onset); evening light delays it (later sleep onset).
Body temperature, cortisol, and melatonin follow predictable circadian patterns that optimize timing for tasks and rest.`,
    tags: ['circadian-rhythm', 'biology', 'sleep'],
  },
  {
    id: 'gut-brain-axis',
    title: 'The Gut-Brain Axis',
    content: `The gut-brain axis is bidirectional communication between the enteric nervous system and the central nervous system.
The gut microbiome produces neurotransmitters (serotonin, GABA, dopamine) that influence mood and cognition.
Vagus nerve signaling carries information from gut bacteria to the brain, affecting anxiety and stress responses.
Dietary fiber, fermented foods, and polyphenols promote microbial diversity linked to better mental health outcomes.
Chronic stress disrupts gut barrier integrity (leaky gut), creating systemic inflammation that affects brain function.`,
    tags: ['gut-brain', 'microbiome', 'neuroscience'],
  },

  // === Finance / Business (8 docs) ===
  {
    id: 'compound-interest-power',
    title: 'The Power of Compound Interest',
    content: `Compound interest earns returns on both the principal and accumulated interest, creating exponential growth.
The Rule of 72: divide 72 by the annual return rate to estimate years needed to double your investment.
Starting early matters enormously — a 25-year-old investing $500/month at 7% beats a 35-year-old investing $1000/month.
Expense ratios compound against you — a 1% fee can consume 28% of your wealth over 30 years.
Reinvesting dividends rather than spending them accelerates compounding through the dividend reinvestment effect.`,
    tags: ['compound-interest', 'investing', 'finance'],
  },
  {
    id: 'etf-investing-guide',
    title: 'ETF Investing Strategy',
    content: `Exchange-Traded Funds bundle many securities into a single tradeable instrument with low expense ratios.
Broad market index ETFs (VTI, VXUS) provide instant diversification across thousands of companies globally.
Dollar-cost averaging into index ETFs removes timing risk and captures long-term market returns consistently.
Tax-loss harvesting swaps similar ETFs to realize losses while maintaining market exposure, reducing tax burden.
A three-fund portfolio (US total market, international, bonds) covers most asset allocation needs with minimal complexity.`,
    tags: ['etf', 'investing', 'portfolio'],
  },
  {
    id: 'startup-metrics-guide',
    title: 'Key Startup Metrics That Matter',
    content: `Monthly Recurring Revenue (MRR) is the baseline metric for SaaS — track net new, expansion, and churn separately.
Customer Acquisition Cost (CAC) must be recovered within the payback period, ideally under 12 months.
Lifetime Value (LTV) to CAC ratio should exceed 3:1 for a sustainable business model.
Net Revenue Retention above 120% indicates strong expansion revenue — existing customers grow faster than churn.
Burn multiple (net burn / net new ARR) measures capital efficiency — below 2x is excellent for growth-stage startups.`,
    tags: ['startup-metrics', 'saas', 'business'],
  },
  {
    id: 'remote-work-best-practices',
    title: 'Remote Work Best Practices',
    content: `Asynchronous communication by default respects time zones and reduces meeting overhead for distributed teams.
Documentation-first culture ensures decisions and context are accessible without synchronous meetings.
Dedicated workspace with ergonomic setup separates work from personal life, maintaining psychological boundaries.
Intentional social rituals (virtual coffee, team retrospectives) prevent isolation and maintain team cohesion.
Results-based evaluation replaces presence-based management — define clear deliverables and measure outcomes, not hours.`,
    tags: ['remote-work', 'team-management', 'async'],
  },
  {
    id: 'okr-methodology',
    title: 'OKR Methodology: Objectives and Key Results',
    content: `OKRs separate aspirational direction (Objectives) from measurable progress indicators (Key Results).
Objectives should be qualitative, inspiring, and time-bound — they answer "where do we want to go?"
Key Results are quantitative and verifiable — they answer "how will we know we arrived?"
Stretch goals (70% achievement is success) encourage ambition while preventing sandbagging of targets.
Quarterly cadence with weekly check-ins balances strategic direction with tactical adaptation as conditions change.`,
    tags: ['okr', 'goal-setting', 'management'],
  },
  {
    id: 'lean-startup-methodology',
    title: 'Lean Startup Methodology',
    content: `The Lean Startup applies scientific experimentation to business model validation through Build-Measure-Learn loops.
A Minimum Viable Product (MVP) tests the riskiest assumptions with minimum effort before full development.
Validated learning replaces vanity metrics — only experiments that confirm or reject hypotheses count as progress.
The pivot decision comes when current hypotheses are invalidated — persevere with data, or change direction.
Continuous deployment and split testing enable rapid iteration cycles measured in days rather than months.`,
    tags: ['lean-startup', 'entrepreneurship', 'product'],
  },
  {
    id: 'product-market-fit',
    title: 'Finding Product-Market Fit',
    content: `Product-market fit means being in a good market with a product that satisfies that market's urgent need.
Sean Ellis test: if 40% or more of surveyed users would be "very disappointed" without your product, you have PMF.
Before PMF, optimize for learning speed — after PMF, optimize for growth and scaling operations.
Leading indicators: organic word-of-mouth growth, high engagement retention cohorts, and pull from the market.
Most startups fail by scaling prematurely — spending on growth before achieving genuine product-market fit.`,
    tags: ['product-market-fit', 'startup', 'growth'],
  },
  {
    id: 'value-investing-principles',
    title: 'Value Investing Principles',
    content: `Value investing, pioneered by Benjamin Graham and refined by Warren Buffett, buys assets below intrinsic value.
Margin of safety — purchasing at a significant discount to calculated intrinsic value — protects against errors.
Mr. Market allegory: the market offers prices daily but you choose when to buy or sell based on value, not mood.
Circle of competence: only invest in businesses you genuinely understand, regardless of what others are buying.
Long-term holding reduces transaction costs and taxes while allowing compounding to work without interruption.`,
    tags: ['value-investing', 'finance', 'buffett'],
  },

  // === Communication / Writing (5 docs) ===
  {
    id: 'technical-writing-principles',
    title: 'Technical Writing Principles',
    content: `Technical writing prioritizes clarity over cleverness — every sentence should have exactly one interpretation.
Use active voice ("the function returns a value") rather than passive ("a value is returned by the function").
Structure content with progressive disclosure: summary first, then details for those who need them.
Code examples should be minimal, complete, and runnable — readers will copy-paste before reading explanations.
Consistent terminology matters: pick one term for each concept and use it everywhere (avoid elegant variation).`,
    tags: ['technical-writing', 'documentation', 'communication'],
  },
  {
    id: 'storytelling-persuasion',
    title: 'Storytelling for Persuasion and Teaching',
    content: `Stories bypass analytical resistance because the brain processes narrative differently from logical argument.
The hero's journey structure (challenge → struggle → transformation) maps onto any persuasive presentation.
Concrete details and sensory language activate mirror neurons, creating empathetic engagement in listeners.
Data wrapped in narrative is 22 times more memorable than statistics presented alone (Stanford research).
Opening with a specific moment (not a generalization) immediately grounds the audience in the experience.`,
    tags: ['storytelling', 'persuasion', 'communication'],
  },
  {
    id: 'active-listening-skills',
    title: 'Active Listening as a Core Skill',
    content: `Active listening means fully concentrating on what is said rather than planning your response while they speak.
Reflective responses ("What I'm hearing is...") confirm understanding and make the speaker feel genuinely heard.
Pausing 3-5 seconds before responding creates space for deeper thought and signals thoughtfulness.
Non-verbal cues (eye contact, open posture, nodding) communicate attention as powerfully as verbal responses.
The biggest barrier to listening is the assumption that you already know what the other person will say.`,
    tags: ['active-listening', 'communication', 'relationships'],
  },
  {
    id: 'giving-feedback-effectively',
    title: 'Giving Effective Feedback',
    content: `The SBI model structures feedback: Situation (when/where), Behavior (observable action), Impact (effect on others).
Feedback should be timely — within 24-48 hours of the event while context remains fresh for both parties.
Separate observation from evaluation: describe what happened before interpreting what it means.
Positive-to-negative ratio matters — research suggests 5:1 in ongoing relationships for psychological safety.
Ask permission before giving feedback and focus on changeable behaviors, not personality traits or identity.`,
    tags: ['feedback', 'leadership', 'communication'],
  },
  {
    id: 'public-speaking-techniques',
    title: 'Public Speaking: Overcoming Fear and Engaging Audiences',
    content: `Speech anxiety is the body's fight-or-flight response — reframing arousal as excitement reduces its negative effect.
The rule of three: audiences remember three main points; structure talks in triads for maximum retention.
Opening with a question, surprising statistic, or personal story captures attention within the first 30 seconds.
Deliberate pauses after key points create emphasis and allow the audience time to process complex ideas.
Practice delivery (not just content) until the mechanics are automatic, freeing cognitive resources for connection.`,
    tags: ['public-speaking', 'presentation', 'communication'],
  },

  // === Miscellaneous Knowledge (5 docs) ===
  {
    id: 'climate-change-basics',
    title: 'Climate Change: Scientific Consensus',
    content: `Earth's average temperature has risen approximately 1.1 degrees Celsius since pre-industrial times due to greenhouse gases.
CO2 from fossil fuel combustion is the primary driver, trapping infrared radiation that would otherwise escape to space.
Feedback loops (ice albedo, permafrost methane, water vapor) amplify initial warming beyond direct CO2 effects.
The carbon budget — remaining emissions before crossing 1.5C — is estimated at roughly 400 gigatons of CO2.
Mitigation requires both reducing emissions (renewables, efficiency) and removing existing CO2 (reforestation, DAC).`,
    tags: ['climate-change', 'environment', 'science'],
  },
  {
    id: 'space-exploration-progress',
    title: 'Space Exploration: Current Progress',
    content: `Reusable rockets (SpaceX Falcon 9, Starship) have reduced launch costs by over 90%, democratizing space access.
The Artemis program aims to establish sustained human presence on the Moon as a stepping stone to Mars.
James Webb Space Telescope observes in infrared, revealing the earliest galaxies formed after the Big Bang.
Private space stations (Axiom, Orbital Reef) will replace the aging ISS as commercial orbital platforms.
In-situ resource utilization (ISRU) — using local materials for fuel and building — is key to sustainable off-Earth presence.`,
    tags: ['space', 'exploration', 'technology'],
  },
  {
    id: 'history-of-computing',
    title: 'A Brief History of Computing',
    content: `From Babbage's Analytical Engine (1837) to ENIAC (1945), computing evolved from mechanical to electronic.
The transistor (1947) replaced vacuum tubes, enabling smaller, faster, and more reliable machines.
Moore's Law — transistor density doubling every two years — drove exponential computing growth for five decades.
The internet (ARPANET 1969, WWW 1991) transformed computing from calculation tool to communication platform.
Current frontiers include quantum computing, neuromorphic chips, and AI accelerators (GPUs, TPUs) reshaping the field.`,
    tags: ['computing-history', 'technology', 'science'],
  },
  {
    id: 'philosophy-of-mind',
    title: 'Philosophy of Mind: Key Problems',
    content: `The hard problem of consciousness asks why subjective experience (qualia) exists at all — why is there "something it is like."
Physicalism claims mental states are identical to or supervene on brain states, but struggles with explanatory gap.
Functionalism defines minds by what they do (input-output mappings) rather than what they are made of.
The Chinese Room argument challenges whether syntactic manipulation alone can produce genuine understanding.
Integrated Information Theory (IIT) proposes that consciousness correlates with a system's capacity for integrated information (phi).`,
    tags: ['philosophy', 'consciousness', 'mind'],
  },
  {
    id: 'systems-thinking-principles',
    title: 'Systems Thinking: Seeing Wholes',
    content: `Systems thinking views problems as parts of an overall system rather than isolated events with linear causes.
Feedback loops (reinforcing and balancing) drive system behavior — identifying them reveals leverage points.
Emergence means system-level properties arise from interactions that cannot be predicted from individual components alone.
Delays between action and consequence cause oscillation and overshoot — patience and measurement prevent overreaction.
Donella Meadows identified 12 leverage points, with paradigm shifts and system goals being most powerful for change.`,
    tags: ['systems-thinking', 'complexity', 'mental-models'],
  },
];

// ─── 20 English Golden Queries ───
export const GOLDEN_QUERIES_EN: GoldenQuery[] = [
  // === Easy (7): Direct keyword match ===
  {
    id: 'q21-rust-ownership',
    query: 'How does Rust ownership and borrowing work?',
    relevant: ['rust-ownership-model'],
    difficulty: 'easy',
    description: 'Direct keyword match: "Rust" + "ownership" + "borrowing"',
  },
  {
    id: 'q22-kubernetes-pods',
    query: 'Kubernetes pods and deployments',
    relevant: ['kubernetes-core-concepts'],
    difficulty: 'easy',
    description: 'Direct keyword match: "Kubernetes" + "pods" + "deployments"',
  },
  {
    id: 'q23-gtd-weekly-review',
    query: 'GTD weekly review process',
    relevant: ['gtd-methodology', 'weekly-review-practice'],
    difficulty: 'easy',
    description: 'Direct keyword match: "GTD" + "weekly review"',
  },
  {
    id: 'q24-compound-interest',
    query: 'How does compound interest work for investing?',
    relevant: ['compound-interest-power'],
    difficulty: 'easy',
    description: 'Direct keyword match: "compound interest" + "investing"',
  },
  {
    id: 'q25-sleep-cycles',
    query: 'Sleep cycles and REM stages',
    relevant: ['sleep-science-fundamentals'],
    difficulty: 'easy',
    description: 'Direct keyword match: "sleep cycles" + "REM"',
  },
  {
    id: 'q26-oauth-tokens',
    query: 'OAuth 2.0 access tokens and refresh tokens',
    relevant: ['oauth-authentication-flows'],
    difficulty: 'easy',
    description: 'Direct keyword match: "OAuth" + "access tokens" + "refresh tokens"',
  },
  {
    id: 'q27-cognitive-biases',
    query: 'What are common cognitive biases in decision making?',
    relevant: ['cognitive-biases-overview'],
    difficulty: 'easy',
    description: 'Direct keyword match: "cognitive biases" + "decision"',
  },

  // === Medium (7): Paraphrased / synonym queries ===
  {
    id: 'q28-habit-formation',
    query: 'How to build lasting behavioral changes through small daily routines',
    relevant: ['atomic-habits-framework', 'morning-routines-research'],
    difficulty: 'medium',
    description: 'Paraphrase: "small daily routines" → atomic habits; "behavioral changes" → habits framework',
  },
  {
    id: 'q29-api-efficiency',
    query: 'Fetching only the data you need from server endpoints',
    relevant: ['graphql-fundamentals'],
    difficulty: 'medium',
    description: 'Paraphrase: "fetching only data you need" → GraphQL over-fetching/under-fetching prevention',
  },
  {
    id: 'q30-scaling-web-services',
    query: 'How to handle millions of concurrent users in a web application',
    relevant: ['system-design-scalability', 'microservices-architecture'],
    difficulty: 'hard',
    description: 'Thematic: "millions of users" → scalability patterns + microservices (no keyword overlap)',
  },
  {
    id: 'q31-personal-knowledge-system',
    query: 'Organizing notes with bidirectional links and emergent structure',
    relevant: ['zettelkasten-english', 'para-method-organizing'],
    difficulty: 'medium',
    description: 'Paraphrase: "bidirectional links + emergent structure" → Zettelkasten + PARA methods',
  },
  {
    id: 'q32-startup-validation',
    query: 'Testing business ideas before building the full product',
    relevant: ['lean-startup-methodology', 'product-market-fit'],
    difficulty: 'medium',
    description: 'Paraphrase: "testing ideas before building" → MVP + validated learning + PMF',
  },
  {
    id: 'q33-memory-safe-languages',
    query: 'Programming languages that prevent use-after-free and data race bugs',
    relevant: ['rust-ownership-model'],
    difficulty: 'medium',
    description: 'Paraphrase: "prevent use-after-free" → Rust ownership system guarantees',
  },
  {
    id: 'q34-writing-clear-docs',
    query: 'Making documentation unambiguous and easy to follow',
    relevant: ['technical-writing-principles'],
    difficulty: 'hard',
    description: 'Thematic: "unambiguous + easy to follow" → technical writing (no shared keywords)',
  },

  // === Hard (6): Thematic connection only ===
  {
    id: 'q35-avoiding-distractions',
    query: 'How to protect attention and avoid constant interruptions',
    relevant: ['flow-state-psychology', 'digital-minimalism', 'time-blocking-method'],
    difficulty: 'hard',
    description: 'Thematic: "protect attention" connects to flow, digital minimalism, time blocking — no keyword overlap',
  },
  {
    id: 'q36-making-better-decisions',
    query: 'Why do smart people consistently make irrational choices?',
    relevant: ['cognitive-biases-overview', 'systems-thinking-principles'],
    difficulty: 'hard',
    description: 'Thematic: "irrational choices by smart people" → cognitive biases + systems thinking (feedback loops, delays)',
  },
  {
    id: 'q37-gut-mood-connection',
    query: 'Can what you eat affect your mental state and emotions?',
    relevant: ['gut-brain-axis', 'nutrition-fundamentals'],
    difficulty: 'hard',
    description: 'Thematic: "eat affect mental state" → gut-brain axis neurotransmitter production + nutrition microbiome effects',
  },
  {
    id: 'q38-learning-faster',
    query: 'How does the brain physically change when acquiring new skills?',
    relevant: ['neuroplasticity-learning', 'exercise-science-principles'],
    difficulty: 'hard',
    description: 'Thematic: "brain physically change" → neuroplasticity (BDNF, synapses) + exercise (BDNF increase)',
  },
  {
    id: 'q39-long-term-wealth',
    query: 'What separates people who build generational wealth from those who do not?',
    relevant: ['compound-interest-power', 'value-investing-principles', 'etf-investing-guide'],
    difficulty: 'hard',
    description: 'Thematic: "generational wealth" → compounding, long-term holding, margin of safety — no direct keyword match',
  },
  {
    id: 'q40-distributed-transactions',
    query: 'Ensuring data consistency when one part of the system fails during a multi-step operation',
    relevant: ['microservices-architecture', 'testing-strategies-comprehensive'],
    difficulty: 'hard',
    description: 'Thematic: "data consistency + partial failure" → Saga pattern (microservices) + chaos engineering (testing)',
  },
];
