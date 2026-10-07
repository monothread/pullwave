import { LLM_PROVIDERS, type LlmCompletionResult, type LlmError, type LlmProtocol, type LlmProviderId } from '@shared/llm';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RAW_LENGTH = 500;
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 8192;
const QUOTA_HINT = /quota|billing|credit|balance|insufficient/i;
const INVALID_KEY_HINT = /api key not valid|invalid api key|invalid x-api-key|unauthorized/i;

export interface LlmRequest {
    provider: LlmProviderId;
    // Empty to use the address of the provider.
    baseUrl: string;
    model: string;
    token: string;
    system: string;
    user: string;
    // Aborted when the user cancels.
    signal?: AbortSignal;
    // How long the provider has to answer; two minutes when not given.
    timeoutMs?: number;
}

export type LlmFetch = (url: string, init: RequestInit) => Promise<Response>;

interface PreparedRequest {
    url: string;
    headers: Record<string, string>;
    body: unknown;
}

function joinUrl(base: string, path: string): string {
    return `${base.replace(/\/+$/, '')}${path}`;
}

function openAiRequest(request: LlmRequest, base: string): PreparedRequest {
    return {
        url: joinUrl(base, '/chat/completions'),
        headers: { Authorization: `Bearer ${request.token}` },
        body: {
            model: request.model,
            messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.user }
            ]
        }
    };
}

function anthropicRequest(request: LlmRequest, base: string): PreparedRequest {
    return {
        url: joinUrl(base, '/messages'),
        headers: { 'x-api-key': request.token, 'anthropic-version': ANTHROPIC_VERSION },
        body: {
            model: request.model,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            system: request.system,
            messages: [{ role: 'user', content: request.user }]
        }
    };
}

function geminiRequest(request: LlmRequest, base: string): PreparedRequest {
    return {
        url: joinUrl(base, `/models/${encodeURIComponent(request.model)}:generateContent`),
        headers: { 'x-goog-api-key': request.token },
        body: {
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.user }] }]
        }
    };
}

const BUILDERS: Record<LlmProtocol, (request: LlmRequest, base: string) => PreparedRequest> = {
    openai: openAiRequest,
    anthropic: anthropicRequest,
    gemini: geminiRequest
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function textsOf(parts: unknown, key: string): string | null {
    if (!Array.isArray(parts)) {
        return null;
    }
    const texts = parts
        .filter((part): part is Record<string, unknown> => {
            return isRecord(part) && typeof part[key] === 'string';
        })
        .map((part) => {
            return part[key] as string;
        });
    return texts.length > 0 ? texts.join('') : null;
}

function openAiText(body: unknown): string | null {
    if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0]) || !isRecord(body.choices[0].message)) {
        return null;
    }
    const content = body.choices[0].message.content;
    return typeof content === 'string' ? content : null;
}

function anthropicText(body: unknown): string | null {
    return isRecord(body) ? textsOf(body.content, 'text') : null;
}

function geminiText(body: unknown): string | null {
    if (!isRecord(body) || !Array.isArray(body.candidates) || !isRecord(body.candidates[0]) || !isRecord(body.candidates[0].content)) {
        return null;
    }
    return textsOf(body.candidates[0].content.parts, 'text');
}

const READERS: Record<LlmProtocol, (body: unknown) => string | null> = {
    openai: openAiText,
    anthropic: anthropicText,
    gemini: geminiText
};

function retryAfterOf(response: Response): number | undefined {
    const seconds = Number(response.headers.get('retry-after'));
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export function errorOf(code: LlmError['code'], raw: string, token: string, retryAfterSeconds?: number): LlmError {
    const clean = (token.length > 0 ? raw.split(token).join('[token]') : raw).slice(0, MAX_RAW_LENGTH);
    return retryAfterSeconds === undefined ? { code, raw: clean } : { code, raw: clean, retryAfterSeconds };
}

// What the status of an answer that is not a success means.
export function failureOf(response: Response, text: string, token: string): LlmError {
    const { status } = response;
    if (status === 401 || status === 403 || INVALID_KEY_HINT.test(text)) {
        return errorOf('INVALID_TOKEN', text, token);
    }
    if (status === 402 || (status === 429 && QUOTA_HINT.test(text))) {
        return errorOf('QUOTA_EXCEEDED', text, token);
    }
    if (status === 429) {
        return errorOf('RATE_LIMITED', text, token, retryAfterOf(response));
    }
    if (status === 404) {
        return errorOf('MODEL_NOT_FOUND', text, token);
    }
    return errorOf('BAD_RESPONSE', `HTTP ${status}: ${text}`, token);
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

// Asks a language model for a text, in the protocol of the provider. Never throws: what went wrong comes back as an error.
export async function completeWithLlm(request: LlmRequest, fetchImpl: LlmFetch = fetch): Promise<LlmCompletionResult> {
    const info = LLM_PROVIDERS[request.provider];
    const base = request.baseUrl.length > 0 ? request.baseUrl : info.defaultBaseUrl;
    const prepared = BUILDERS[info.protocol](request, base);
    const timeout = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    try {
        const response = await fetchImpl(prepared.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...prepared.headers },
            body: JSON.stringify(prepared.body),
            signal
        });
        const text = await response.text();
        if (!response.ok) {
            return { ok: false, error: failureOf(response, text, request.token) };
        }
        const answer = READERS[info.protocol](parseJson(text));
        if (answer === null) {
            return { ok: false, error: errorOf('BAD_RESPONSE', `The answer has no text: ${text}`, request.token) };
        }
        return { ok: true, text: answer };
    } catch (error) {
        if (request.signal?.aborted === true) {
            return { ok: false, error: { code: 'CANCELLED', raw: 'The translation was cancelled.' } };
        }
        if (timeout.aborted) {
            return { ok: false, error: { code: 'TIMEOUT', raw: 'The provider did not answer in time.' } };
        }
        return { ok: false, error: errorOf('NETWORK', error instanceof Error ? error.message : String(error), request.token) };
    }
}
