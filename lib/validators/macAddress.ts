export interface MacValidationResult {
  valid: boolean;
  normalized?: string;
  reason?: string;
}

const MAC_ADDRESS_REGEX = /^([0-9A-F]{2})([:-])(?:[0-9A-F]{2}\2){4}[0-9A-F]{2}$/i;
const REPEATED_CHAR_PATTERN = /^([0-9A-F])\1{11}$/;
const REPEATED_PAIR_PATTERN = /^([0-9A-F]{2})\1{5}$/;

function isSequentialRepeatedDigits(pairs: string[]): boolean {
  if (pairs.length !== 6) return false;
  if (!pairs.every((pair) => pair[0] === pair[1])) return false;
  if (!pairs.every((pair) => /^[0-9]{2}$/.test(pair))) return false;

  const digits = pairs.map((pair) => Number(pair[0]));
  for (let i = 1; i < digits.length; i += 1) {
    if ((digits[i - 1] + 1) % 10 !== digits[i]) {
      return false;
    }
  }

  return true;
}

export function validateMacAddress(input: string | null | undefined): MacValidationResult {
  if (!input) {
    return { valid: false, reason: 'missing' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'empty' };
  }

  if (!MAC_ADDRESS_REGEX.test(trimmed)) {
    return { valid: false, reason: 'format' };
  }

  const sanitized = trimmed.replace(/[:-]/g, '').toUpperCase();
  if (sanitized.length !== 12) {
    return { valid: false, reason: 'length' };
  }

  if (REPEATED_CHAR_PATTERN.test(sanitized)) {
    return { valid: false, reason: 'repeated_characters' };
  }

  if (REPEATED_PAIR_PATTERN.test(sanitized)) {
    return { valid: false, reason: 'repeated_pairs' };
  }

  const pairs = sanitized.match(/.{2}/g) ?? [];
  if (isSequentialRepeatedDigits(pairs)) {
    return { valid: false, reason: 'sequential_repeated_digits' };
  }

  return {
    valid: true,
    normalized: pairs.join(':'),
  };
}

export function describeMacIssue(reason?: string): string {
  switch (reason) {
    case 'missing':
    case 'empty':
      return 'The MAC address is missing.';
    case 'format':
    case 'length':
      return 'The MAC address is not in a recognized format.';
    case 'repeated_characters':
      return 'The MAC address cannot be the same character repeated.';
    case 'repeated_pairs':
      return 'The MAC address cannot repeat the same pair six times.';
    case 'sequential_repeated_digits':
      return 'The MAC address looks like a simple digit sequence and needs to be updated.';
    default:
      return 'The MAC address needs to be reviewed.';
  }
}

