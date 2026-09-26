/**
 * Whether a value looks like an email address: something, an @, then a domain with at least
 * one dot. It only catches typos early; the API checks addresses properly. No part of the
 * pattern can match what the next part starts with, so checking takes linear time.
 */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value.trim())
}
