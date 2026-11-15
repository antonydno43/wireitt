import type {
  DelayNodeData,
  HttpNodeData,
  NotifyNodeData,
  RespondNodeData,
  TransformNodeData,
} from '@/types';
import { allowPrivateHttp } from '@/lib/env';
import { evaluateCondition, renderTemplate, renderValue, type EngineContext } from './templating';

export interface NodeResult {
  output: unknown;
  summary: string;
}

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.internal$|.*\.local$|metadata\.google\.internal$)/i;

/** Basic SSRF guard: block loopback/private targets in production. */
export function assertPublicUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol "${url.protocol}" — only http/https allowed`);
  }
  if (!allowPrivateHttp() && PRIVATE_HOST_RE.test(url.hostname)) {
    throw new Error('Requests to private/internal addresses are blocked in production');
  }
  return url;
}

function truncateForStorage(value: unknown, maxChars = 8000): unknown {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (s.length <= maxChars) return value;
    return s.slice(0, maxChars) + `…(truncated ${s.length - maxChars} chars)`;
  } catch {
    return String(value);
  }
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function httpAction(data: HttpNodeData, ctx: EngineContext): Promise<NodeResult> {
  const method = (data.method ?? 'GET').toUpperCase();
  const url = renderTemplate(String(data.url ?? ''), ctx).trim();
  if (!url) throw new Error('URL is empty');
  const parsed = assertPublicUrl(url);

  const headers: Record<string, string> = {};
  for (const h of data.headers ?? []) {
    const key = String(h?.key ?? '').trim();
    if (!key) continue;
    headers[key] = renderTemplate(String(h?.value ?? ''), ctx);
  }

  let body: string | undefined;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const rawBody = String(data.body ?? '');
    if (rawBody.trim()) {
      body = String(renderValue(rawBody, ctx));
      if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }

  const timeoutMs = Math.min(Number(data.timeoutMs) || 10_000, 10_000);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(parsed, {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError') throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw new Error(`Request failed: ${err.message}`);
  }
  const text = await res.text();
  const elapsed = Date.now() - started;
  const output = {
    status: res.status,
    ok: res.ok,
    url: parsed.toString(),
    durationMs: elapsed,
    body: truncateForStorage(parseMaybeJson(text), 16_000),
  };
  return { output, summary: `HTTP ${method} → ${res.status} (${elapsed}ms)` };
}

async function conditionAction(data: import('@/types').ConditionNodeData, ctx: EngineContext): Promise<NodeResult> {
  const result = evaluateCondition(data, ctx);
  return {
    output: { passed: result.passed, left: result.left, right: result.right, operator: result.operator },
    summary: `${result.operator} → ${result.passed ? 'true' : 'false'}`,
  };
}

async function transformAction(data: TransformNodeData, ctx: EngineContext): Promise<NodeResult> {
  const output: Record<string, unknown> = {};
  for (const f of data.fields ?? []) {
    const key = String(f?.key ?? '').trim();
    if (!key) continue;
    output[key] = renderValue(String(f?.value ?? ''), ctx);
  }
  return { output, summary: `${Object.keys(output).length} field(s) mapped` };
}

async function delayAction(data: DelayNodeData): Promise<NodeResult> {
  const raw = Number(data.ms ?? 1000);
  const ms = Math.min(Math.max(Number.isFinite(raw) ? Math.floor(raw) : 1000, 100), 30_000);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return { output: { waitedMs: ms }, summary: `waited ${ms}ms` };
}

function respondAction(data: RespondNodeData, ctx: EngineContext): NodeResult {
  const status = Math.min(Math.max(Number(data.status) || 200, 100), 599);
  const body = renderValue(String(data.body ?? '{}'), ctx);
  return { output: { status, body }, summary: `respond ${status}` };
}

async function notifyAction(data: NotifyNodeData, ctx: EngineContext): Promise<NodeResult> {
  const provider = data.provider ?? 'custom';
  const text = renderTemplate(String(data.text ?? ''), ctx);
  let url: string;
  let payload: Record<string, unknown>;

  if (provider === 'telegram') {
    const token = String(data.botToken ?? '').trim();
    const chatId = String(data.chatId ?? '').trim();
    if (!token || !chatId) throw new Error('Telegram needs a bot token and chat ID');
    url = `https://api.telegram.org/bot${token}/sendMessage`;
    payload = { chat_id: chatId, text };
  } else {
    url = renderTemplate(String(data.url ?? ''), ctx).trim();
    if (!url) throw new Error('Webhook URL is empty');
    payload = provider === 'discord' ? { content: text } : { text };
  }

  const parsed = assertPublicUrl(url);
  const res = await fetch(parsed, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  }).catch((e: Error) => {
    throw new Error(`Delivery failed: ${e.message}`);
  });

  if (!res.ok) {
    const errText = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${provider} returned ${res.status}${errText ? `: ${errText}` : ''}`);
  }
  return { output: { delivered: true, provider, status: res.status }, summary: `${provider} message delivered (${res.status})` };
}

export async function runNode(
  node: { id: string; type: string; data: Record<string, unknown> },
  ctx: EngineContext
): Promise<NodeResult> {
  switch (node.type) {
    case 'action.http':
      return httpAction(node.data as unknown as HttpNodeData, ctx);
    case 'action.condition':
      return conditionAction(node.data as unknown as import('@/types').ConditionNodeData, ctx);
    case 'action.transform':
      return transformAction(node.data as unknown as TransformNodeData, ctx);
    case 'action.delay':
      return delayAction(node.data as unknown as DelayNodeData);
    case 'action.respond':
      return respondAction(node.data as unknown as RespondNodeData, ctx);
    case 'action.notify':
      return notifyAction(node.data as unknown as NotifyNodeData, ctx);
    default:
      throw new Error(`Unsupported node type: ${node.type}`);
  }
}

export function truncateLogData(value: unknown): unknown {
  return truncateForStorage(value, 4000);
}
