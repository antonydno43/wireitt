import type { ConditionNodeData, StepResult } from '@/types';

// ---------------------------------------------------------------
// Template engine: {{path.to.value}} expressions resolved against
// the run context (trigger payload, previous step outputs, flow).
// No eval — pure data lookups, safe by construction.
// ---------------------------------------------------------------

export interface EngineContext {
  trigger: { type: string; payload: unknown };
  steps: Record<string, StepResult>;
  flow: { id: string; name: string };
  vars: Record<string, unknown>;
}

export function getPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (Number.isInteger(idx) && idx >= 0 && idx < current.length) {
        current = current[idx];
        continue;
      }
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
}

function resolveReference(ref: string, ctx: EngineContext): unknown {
  const rootCtx: Record<string, unknown> = {
    trigger: ctx.trigger,
    steps: ctx.steps,
    flow: ctx.flow,
    vars: ctx.vars,
    now: new Date().toISOString(),
  };
  return getPath(rootCtx, ref);
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Render a string template — embedded values are stringified. */
export function renderTemplate(str: string, ctx: EngineContext): string {
  return str.replace(TEMPLATE_RE, (_m, ref: string) => stringifyValue(resolveReference(ref, ctx)));
}

/**
 * Render a value: when the whole input is a single template the raw
 * (typed) value is returned, so objects/numbers survive the round trip.
 */
export function renderValue(input: string, ctx: EngineContext): unknown {
  const trimmed = input.trim();
  const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(trimmed);
  if (whole) return resolveReference(whole[1], ctx);
  if (trimmed.includes('{{')) return renderTemplate(input, ctx);
  return input;
}

// ---------------- condition evaluation ----------------

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

export function evaluateCondition(data: ConditionNodeData, ctx: EngineContext): {
  passed: boolean;
  left: unknown;
  right: unknown;
  operator: string;
} {
  const operator = data.operator ?? 'eq';
  const left = renderValue(String(data.left ?? ''), ctx);
  const right = renderValue(String(data.right ?? ''), ctx);

  const leftStr = stringifyValue(left);
  const rightStr = stringifyValue(right);
  const bothNumeric = leftStr !== '' && rightStr !== '' && NUMERIC_RE.test(leftStr) && NUMERIC_RE.test(rightStr);

  let passed = false;
  switch (operator) {
    case 'exists':
      passed = left !== undefined && left !== null;
      break;
    case 'not_exists':
      passed = left === undefined || left === null;
      break;
    case 'eq':
      passed = bothNumeric ? Number(leftStr) === Number(rightStr) : leftStr === rightStr;
      break;
    case 'ne':
      passed = bothNumeric ? Number(leftStr) !== Number(rightStr) : leftStr !== rightStr;
      break;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = bothNumeric ? Number(leftStr) : leftStr;
      const b = bothNumeric ? Number(rightStr) : rightStr;
      if (bothNumeric) {
        passed =
          operator === 'gt' ? a > b : operator === 'gte' ? a >= b : operator === 'lt' ? a < b : a <= b;
      } else {
        passed =
          operator === 'gt'
            ? leftStr > rightStr
            : operator === 'gte'
              ? leftStr >= rightStr
              : operator === 'lt'
                ? leftStr < rightStr
                : leftStr <= rightStr;
      }
      break;
    }
    case 'contains':
      passed = leftStr.includes(rightStr);
      break;
    case 'not_contains':
      passed = !leftStr.includes(rightStr);
      break;
    case 'starts_with':
      passed = leftStr.startsWith(rightStr);
      break;
    case 'ends_with':
      passed = leftStr.endsWith(rightStr);
      break;
    default:
      passed = false;
  }
  return { passed, left, right, operator };
}
