export interface ModelPricing {
  readonly inputPer1M: number;
  readonly outputPer1M: number;
  readonly embeddingPer1M?: number;
}

const OPENAI_MODELS: Record<string, ModelPricing> = {
  'gpt-5.6-sol':   { inputPer1M: 5.00, outputPer1M: 30.00 },
  'gpt-5.6-terra': { inputPer1M: 2.50, outputPer1M: 15.00 },
  'gpt-5.6-luna':  { inputPer1M: 1.00, outputPer1M: 6.00 },
  'gpt-5.5':       { inputPer1M: 5.00, outputPer1M: 30.00 },
  'gpt-5.4':       { inputPer1M: 2.50, outputPer1M: 15.00 },
  'gpt-5.4-mini':  { inputPer1M: 0.75, outputPer1M: 4.50 },
  'gpt-5.4-nano':  { inputPer1M: 0.20, outputPer1M: 1.25 },
  'gpt-4.1':       { inputPer1M: 2.00, outputPer1M: 8.00 },
  'gpt-4.1-mini':  { inputPer1M: 0.40, outputPer1M: 1.60 },
  'gpt-4.1-nano':  { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gpt-4o':        { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini':   { inputPer1M: 0.15, outputPer1M: 0.60 },
  'o4-mini':       { inputPer1M: 1.10, outputPer1M: 4.40 },
  'o3-mini':       { inputPer1M: 0.55, outputPer1M: 2.20 },
};

const OPENAI_EMBEDDING_MODELS: Record<string, ModelPricing> = {
  'text-embedding-3-small': { inputPer1M: 0.02, outputPer1M: 0 },
  'text-embedding-3-large': { inputPer1M: 0.13, outputPer1M: 0 },
};

const GEMINI_MODELS: Record<string, ModelPricing> = {
  'gemini-3.5-flash':      { inputPer1M: 1.50, outputPer1M: 9.00 },
  'gemini-3.1-flash-lite': { inputPer1M: 0.25, outputPer1M: 1.50 },
  'gemini-2.5-pro':        { inputPer1M: 1.25, outputPer1M: 10.00 },
  'gemini-2.5-flash':      { inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40 },
};

const GEMINI_EMBEDDING_MODELS: Record<string, ModelPricing> = {
  'gemini-embedding-001': { inputPer1M: 0.15, outputPer1M: 0 },
};

const OLLAMA_PRICING: ModelPricing = { inputPer1M: 0, outputPer1M: 0 };

const PROVIDER_TABLES: Record<string, Record<string, ModelPricing>> = {
  openai: OPENAI_MODELS,
  gemini: GEMINI_MODELS,
};

const EMBEDDING_TABLES: Record<string, Record<string, ModelPricing>> = {
  openai: OPENAI_EMBEDDING_MODELS,
  gemini: GEMINI_EMBEDDING_MODELS,
};

export function getModelPricing(provider: string, model: string): ModelPricing | null {
  const key = provider.toLowerCase();
  if (key === 'ollama') return OLLAMA_PRICING;
  const table = PROVIDER_TABLES[key];
  if (!table) return null;
  return table[model] ?? null;
}

export function getEmbeddingPricing(provider: string, model: string): ModelPricing | null {
  const table = EMBEDDING_TABLES[provider.toLowerCase()];
  if (!table) return null;
  return table[model] ?? null;
}

export const COST_UNAVAILABLE = -1;

export function estimateCostFromPricing(
  pricing: ModelPricing | null,
  promptTokens: number,
  completionTokens: number,
): number {
  if (!pricing) return COST_UNAVAILABLE;
  return (promptTokens / 1_000_000) * pricing.inputPer1M
       + (completionTokens / 1_000_000) * pricing.outputPer1M;
}

export function estimateEmbeddingCostFromPricing(
  pricing: ModelPricing | null,
  totalTokens: number,
): number {
  if (!pricing) return COST_UNAVAILABLE;
  return (totalTokens / 1_000_000) * pricing.inputPer1M;
}
