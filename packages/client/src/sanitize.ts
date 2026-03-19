/**
 * Secret sanitization — strips tokens, passwords, and JWTs from strings
 * before they're sent as telemetry.
 */

const SECRET_PATTERNS = [
  /token[=:\s]+\S+/gi,
  /key[=:\s]+\S+/gi,
  /secret[=:\s]+\S+/gi,
  /password[=:\s]+\S+/gi,
  /bearer\s+\S+/gi,
  /authorization[=:\s]+\S+/gi,
  // JWT pattern
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
]

/** Strip potential secrets from a string. */
export function sanitize(input: string): string {
  let result = input
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

/** Sanitize all string values in a detail object (shallow). */
export function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string') {
      cleaned[key] = sanitize(value)
    } else if (Array.isArray(value)) {
      cleaned[key] = value.map((v) => (typeof v === 'string' ? sanitize(v) : v))
    } else {
      cleaned[key] = value
    }
  }
  return cleaned
}
