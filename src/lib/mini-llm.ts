/**
 * Multi-provider "mini-LLM" JSON client.
 *
 * Quilpen'in mevcut Haiku-only `generateJSONWithUsage` (lib/claude.ts:414)
 * pahalı + yavaş. Bu modül aynı imzayı korur ama backend olarak 6 provider
 * destekler — Contextual Retrieval gibi yüksek-hacimli, basit JSON üreten
 * görevlerde Haiku'nun yerine konabilecek f/p-uygun alternatifler.
 *
 * Provider'lar:
 *   - haiku            → Anthropic Claude Haiku 4.5 (baseline, mevcut SDK)
 *   - gemini-flash     → Google Gemini 2.5 Flash      (REST)
 *   - gemini-flash-lite→ Google Gemini 2.5 Flash-Lite (REST, en ucuz)
 *   - together-llama   → Together AI · Llama 3.3 70B  (OpenAI-compat REST)
 *   - together-qwen    → Together AI · Qwen 2.5 72B   (OpenAI-compat REST)
 *   - groq-llama       → Groq · Llama 3.3 70B (~500 tok/s) (OpenAI-compat REST)
 *   - deepseek         → DeepSeek V3                  (OpenAI-compat REST)
 *
 * Tüm provider'lar ortak output verir: { data, inputTokens, outputTokens,
 * latencyMs, model, provider }. JSON parsing + retry + temizleme her
 * branch'te uygulanır.
 *
 * Pilot test (scripts/eval/pilot-providers.ts) bu modüldeki tüm provider'ları
 * yan-yana çağırır; backfill aşamasında seçilen provider env'dan
 * (MINI_LLM_PROVIDER) okunup tek bir backend kullanılır.
 */

import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

export type MiniLLMProvider =
  | "haiku"
  | "gemini-flash"
  | "gemini-flash-lite"
  | "together-llama"
  | "together-qwen"
  | "groq-llama"
  | "deepseek";

export interface MiniLLMResult<T> {
  data: T;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
  provider: MiniLLMProvider;
}

interface ProviderConfig {
  envKey: string;
  url: string;
  model: string;
  type: "anthropic" | "openai-compat" | "gemini";
}

const PROVIDERS: Record<MiniLLMProvider, ProviderConfig> = {
  haiku: {
    envKey: "ANTHROPIC_API_KEY",
    url: "(SDK)",
    model: process.env.CLAUDE_HAIKU_MODEL ?? HAIKU,
    type: "anthropic",
  },
  "gemini-flash": {
    envKey: "GOOGLE_AI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    model: "gemini-2.5-flash",
    type: "gemini",
  },
  "gemini-flash-lite": {
    envKey: "GOOGLE_AI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    model: "gemini-2.5-flash-lite",
    type: "gemini",
  },
  "together-llama": {
    envKey: "TOGETHER_API_KEY",
    url: "https://api.together.xyz/v1/chat/completions",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    type: "openai-compat",
  },
  "together-qwen": {
    envKey: "TOGETHER_API_KEY",
    url: "https://api.together.xyz/v1/chat/completions",
    model: "Qwen/Qwen2.5-72B-Instruct-Turbo",
    type: "openai-compat",
  },
  "groq-llama": {
    envKey: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    type: "openai-compat",
  },
  deepseek: {
    envKey: "DEEPSEEK_API_KEY",
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    type: "openai-compat",
  },
};

const DEFAULT_PROVIDER: MiniLLMProvider =
  (process.env.MINI_LLM_PROVIDER as MiniLLMProvider | undefined) ?? "haiku";

const JSON_GUARD =
  "You must respond with valid JSON only. Do not include markdown code fences, " +
  "explanations, or any text outside of the JSON object.";

/**
 * Generate JSON via the chosen provider. Behavior:
 * - Builds a JSON-only system prompt (same guard as generateJSONWithUsage).
 * - Calls provider, measures latency.
 * - Strips ```json fences if present, parses, returns typed result.
 * - On parse failure throws with the raw response in the message.
 * - Single attempt — caller adds retries if needed (pilot script doesn't,
 *   each provider gets one fair shot per chunk).
 */
export async function generateMiniJSON<T = unknown>(
  prompt: string,
  systemPrompt: string,
  options?: { provider?: MiniLLMProvider; maxTokens?: number },
): Promise<MiniLLMResult<T>> {
  const provider = options?.provider ?? DEFAULT_PROVIDER;
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unknown mini-llm provider: ${provider}`);

  const fullSystem = [systemPrompt, JSON_GUARD].filter(Boolean).join("\n\n");
  const maxTokens = options?.maxTokens ?? 1024;
  // Some models (notably Gemini Flash) prepend "Here is the JSON requested:" before
  // the JSON object, ignoring responseMimeType. Strip any leading non-JSON text
  // before parse fails — extract the first balanced {...} block.
  const extractJson = (raw: string): string => {
    const trimmed = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    if (trimmed.startsWith("{")) return trimmed;
    const start = trimmed.indexOf("{");
    if (start < 0) return trimmed;
    const end = trimmed.lastIndexOf("}");
    if (end <= start) return trimmed;
    return trimmed.slice(start, end + 1);
  };
  const t0 = Date.now();

  let raw: string;
  let inputTokens = 0;
  let outputTokens = 0;

  if (cfg.type === "anthropic") {
    const res = await generateJSONWithUsage<T>(prompt, systemPrompt, {
      model: cfg.model,
    });
    return {
      data: res.data,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      latencyMs: Date.now() - t0,
      model: cfg.model,
      provider,
    };
  } else if (cfg.type === "gemini") {
    const apiKey = process.env[cfg.envKey];
    if (!apiKey) throw new Error(`${cfg.envKey} env not set`);
    const url = `${cfg.url}/${cfg.model}:generateContent?key=${apiKey}`;
    const body = {
      systemInstruction: { role: "system", parts: [{ text: fullSystem }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0,
        responseMimeType: "application/json",
      },
    };
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(`Gemini ${cfg.model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
    const data = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  } else {
    // openai-compat (together, groq, deepseek)
    const apiKey = process.env[cfg.envKey];
    if (!apiKey) throw new Error(`${cfg.envKey} env not set`);
    const body = {
      model: cfg.model,
      messages: [
        { role: "system", content: fullSystem },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: "json_object" as const },
    };
    const r = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(
        `${provider} (${cfg.model}) HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`,
      );
    }
    const data = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    raw = data.choices?.[0]?.message?.content ?? "";
    inputTokens = data.usage?.prompt_tokens ?? 0;
    outputTokens = data.usage?.completion_tokens ?? 0;
  }

  const latencyMs = Date.now() - t0;
  const jsonStr = extractJson(raw);

  let parsed: T;
  try {
    parsed = JSON.parse(jsonStr) as T;
  } catch {
    throw new Error(
      `${provider} (${cfg.model}) returned non-JSON.\nRaw:\n${raw.slice(0, 500)}`,
    );
  }

  return {
    data: parsed,
    inputTokens,
    outputTokens,
    latencyMs,
    model: cfg.model,
    provider,
  };
}

/** Listele tüm desteklenen provider'lar — pilot script & docs için. */
export function listMiniLLMProviders(): MiniLLMProvider[] {
  return Object.keys(PROVIDERS) as MiniLLMProvider[];
}

/** Provider için env key & model adı oku — diagnostic. */
export function getProviderInfo(provider: MiniLLMProvider): ProviderConfig {
  return PROVIDERS[provider];
}
