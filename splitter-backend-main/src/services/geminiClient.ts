import { GEMINI_RESPONSE_SCHEMA, RECEIPT_PROMPT } from "./scanReceipt.js";

export type AiInput = { imageBase64: string; mimeType: string; language?: string | undefined };
/** Returns the raw text of the model reply. Throws AiError. */
export type ReceiptAi = (input: AiInput) => Promise<string>;

/** `retryable` is true only for failures where the request never produced an answer (network/timeout). */
export class AiError extends Error {
  retryable: boolean;
  status: number | undefined;
  constructor(message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "AiError";
    this.retryable = retryable;
    this.status = status;
  }
}

const API_BASE = "https://generativelanguage.googleapis.com/v1/models";
export const DEFAULT_MODEL = "gemini-3.5-flash";
const MAX_OUTPUT_TOKENS = 8192;

/**
 * ONE generateContent request per receipt. The key goes in a header (never in the URL, so it cannot leak into logs).
 * Retried once, and only when the request itself failed (network error / timeout), never after an HTTP answer:
 * a second paid call after the model has already answered would double the cost.
 */
export const geminiReceiptAi: ReceiptAi = async (input) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("GEMINI_API_KEY is not set", false);
  const model = process.env.GEMINI_MODEL_PARSE || DEFAULT_MODEL;
  const timeoutMs = Number(process.env.SCAN_AI_TIMEOUT_MS) || 60_000;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: RECEIPT_PROMPT }, { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } }],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastNetworkError = e;
      continue;
    }
    if (!resp.ok) {
      // 400/401/403/404/429/5xx from Google: not retried, reported as "AI unavailable"
      throw new AiError(`Gemini HTTP ${resp.status}`, false, resp.status);
    }
    const json = (await resp.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return text;
  }
  throw new AiError(`Gemini unreachable: ${(lastNetworkError as Error)?.name ?? "error"}`, true);
};

let mockCalls = 0;
export const mockCallCount = () => mockCalls;

/**
 * Deterministic stand-in used when ALLOW_MOCK_SCAN=true (tests, offline demos). Free.
 * Behaviour can be chosen per request through the X-Mock-Ai header, which is honoured ONLY in mock mode.
 */
export function mockReceiptAi(behavior: string): ReceiptAi {
  return async () => {
    mockCalls++;
    if (behavior === "unavailable") throw new AiError("mock outage", false, 503);
    if (behavior === "garbage") return "this is not json";
    if (behavior === "not_receipt") return JSON.stringify({ isReceipt: false, items: [] });
    const base = {
      isReceipt: true,
      merchant: "Mock Cafe",
      date: "2026-10-20",
      currency: "USD",
      language: "en",
      items: [
        { name: "Latte", quantity: 2, unitPrice: 3.5, lineTotal: 7, confidence: 0.95 },
        { name: "Cheesecake", quantity: 1, unitPrice: 5.25, lineTotal: 5.25, confidence: 0.9 },
        { name: "Smudged line", quantity: 1, unitPrice: 2, lineTotal: 2, confidence: 0.4 },
      ],
      tax: 1.4,
      tip: 1.5,
      discount: 0,
      total: 17.15,
    };
    if (behavior === "mismatch") base.total = 20;
    return JSON.stringify(base);
  };
}
