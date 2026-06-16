/**
 * kvStore.ts — Vercel KV session store
 * Falls back to in-memory dict for local dev (no KV configured)
 */

import type { SessionData } from "@/types";

const MEMORY: Record<string, string> = {};
const TTL_MS = 7200 * 1000; // 2 hours

async function kvGet(key: string): Promise<string | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return MEMORY[key] ?? null;
  }
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.result ?? null;
}

async function kvSet(key: string, value: string, ttlSeconds = 7200): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    MEMORY[key] = value;
    setTimeout(() => delete MEMORY[key], TTL_MS);
    return;
  }
  await fetch(
    `${process.env.KV_REST_API_URL}/setex/${encodeURIComponent(key)}/${ttlSeconds}/${encodeURIComponent(value)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    }
  );
}

async function kvDel(key: string): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    delete MEMORY[key];
    return;
  }
  await fetch(`${process.env.KV_REST_API_URL}/del/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
}

export async function storeSession(id: string, data: SessionData): Promise<void> {
  await kvSet(`ss:${id}`, JSON.stringify(data));
}

export async function getSession(id: string): Promise<SessionData | null> {
  const raw = await kvGet(`ss:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function deleteSession(id: string): Promise<void> {
  await kvDel(`ss:${id}`);
}

export async function sessionExists(id: string): Promise<boolean> {
  const raw = await kvGet(`ss:${id}`);
  return raw !== null;
}

/** Store raw file bytes (base64) for chat access across invocations */
export async function storeFileBytes(id: string, base64: string): Promise<void> {
  await kvSet(`sf:${id}`, base64, 3600); // 1 hour TTL for files
}

export async function getFileBytes(id: string): Promise<Buffer | null> {
  const b64 = await kvGet(`sf:${id}`);
  if (!b64) return null;
  return Buffer.from(b64, "base64");
}
