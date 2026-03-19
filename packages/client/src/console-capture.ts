/**
 * Console error capture — intercepts console.error and keeps a rolling buffer
 * of recent errors to include in feedback events.
 */

import { sanitize } from './sanitize.js'

const buffer: string[] = []
let maxErrors = 20
let originalConsoleError: ((...args: unknown[]) => void) | null = null

/** Get the current console error buffer (sanitized). */
export function getConsoleErrors(): string[] {
  return buffer.map(sanitize)
}

/** Start capturing console.error calls. */
export function startCapturing(max: number): void {
  if (originalConsoleError) return // already capturing
  maxErrors = max
  originalConsoleError = console.error.bind(console)

  console.error = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')
    if (buffer.length >= maxErrors) buffer.shift()
    buffer.push(msg)
    originalConsoleError!(...args)
  }
}

/** Stop capturing and restore original console.error. */
export function stopCapturing(): void {
  if (originalConsoleError) {
    console.error = originalConsoleError
    originalConsoleError = null
  }
  buffer.length = 0
}
