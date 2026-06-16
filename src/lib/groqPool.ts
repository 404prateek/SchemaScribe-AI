/**
 * groqPool.ts — Round-robin Groq API key pool with 429 rotation
 * Port of _GroqKeyPool from describer.py
 */

let _index = 0;

function loadKeys(): string[] {
  const pool = process.env.GROQ_API_KEYS ?? "";
  const keys = pool ? pool.split(",").map((k) => k.trim()).filter(Boolean) : [];
  const primary = (process.env.GROQ_API_KEY ?? "").trim();
  if (primary && !keys.includes(primary)) keys.unshift(primary);
  return keys;
}

export function getCurrentKey(): string {
  const keys = loadKeys();
  if (keys.length === 0) return "";
  return keys[_index % keys.length];
}

export function rotateKey(): string {
  const keys = loadKeys();
  if (keys.length === 0) return "";
  _index = (_index + 1) % keys.length;
  return keys[_index];
}
