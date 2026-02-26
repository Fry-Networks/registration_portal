export interface ParsedAlgodError {
  rawMessage: string;
  userMessage?: string;
}

const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

const decodeBody = (body: unknown): string | null => {
  const activeDecoder = decoder ?? (typeof TextDecoder !== 'undefined' ? new TextDecoder() : null);
  if (!activeDecoder) return null;

  if (!body) return null;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) {
    return activeDecoder.decode(body);
  }
  if (Array.isArray(body)) {
    try {
      const buf = Uint8Array.from(body as Array<number>);
      return activeDecoder.decode(buf);
    } catch {
      return null;
    }
  }
  if (typeof body === 'object') {
    const values = Object.values(body as Record<string, unknown>);
    if (values.every((value) => typeof value === 'number')) {
      try {
        const buf = Uint8Array.from(values as Array<number>);
        return activeDecoder.decode(buf);
      } catch {
        return null;
      }
    }
  }
  return null;
};

const normalizeMessage = (value: string | null | undefined): string => {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.message === 'string') {
      return parsed.message;
    }
  } catch {
    // fall through to raw string
  }
  return value;
};

export function parseAlgodError(error: unknown): ParsedAlgodError | null {
  const body = decodeBody((error as any)?.response?.body);
  const rawParts: string[] = [];

  if (body) {
    rawParts.push(normalizeMessage(body));
  }
  if (error instanceof Error && error.message) {
    rawParts.push(normalizeMessage(error.message));
  } else if (typeof error === 'string') {
    rawParts.push(normalizeMessage(error));
  }

  const rawMessage = rawParts.filter(Boolean).join(' | ').trim();
  if (!rawMessage) {
    return null;
  }

  const lower = rawMessage.toLowerCase();
  let userMessage: string | undefined;

  if (lower.includes('underflow') || lower.includes('overspend') || lower.includes('insufficient')) {
    userMessage =
      'The sending wallet does not have enough balance (including minimum balance) to cover this transaction. Please add funds and try again.';
  } else if (lower.includes('should have been authorized')) {
    userMessage =
      'The transaction was signed by a different account. Reconnect the correct wallet on the right network and retry.';
  } else if (lower.includes('must optin') || lower.includes('must opt-in') || lower.includes('not opted')) {
    userMessage =
      'The receiving wallet must opt into this asset before it can receive it. Please opt in and retry.';
  } else if (lower.includes('already in ledger') || lower.includes('duplicate transaction')) {
    userMessage = 'This transaction was already submitted. Wait for confirmation or refresh before retrying.';
  }

  return { rawMessage, userMessage };
}
