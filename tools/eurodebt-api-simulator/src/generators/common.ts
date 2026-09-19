import { randomUUID } from 'node:crypto'

export type GenCtx = {
  index: number
  batchId: string
  vars?: Record<string, unknown>
  seed?: string
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function seedFrom(ctx: GenCtx): number {
  const base = ctx.seed ?? `${ctx.batchId}:${ctx.index}`
  let h = 2166136261
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function rng(ctx: GenCtx) {
  return mulberry32(seedFrom(ctx))
}

export function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length) % items.length]
}

export function intBetween(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}

export function floatBetween(rand: () => number, min: number, max: number, digits = 2): number {
  const v = min + rand() * (max - min)
  const f = 10 ** digits
  return Math.round(v * f) / f
}

export function isoDaysFromNow(rand: () => number, minDays: number, maxDays: number): string {
  const days = intBetween(rand, minDays, maxDays)
  const d = new Date(Date.now() + days * 86_400_000)
  return d.toISOString()
}

export function externalId(ctx: GenCtx, prefix = 'OM'): string {
  return `${prefix}-${ctx.batchId}-${ctx.index}-${randomUUID().slice(0, 8)}`
}

export const CITIES = [
  { name: 'Warszawa', country: 'pl', postal: '00-001', lat: 52.2297, lon: 21.0122 },
  { name: 'Łódź', country: 'pl', postal: '90-001', lat: 51.7592, lon: 19.456 },
  { name: 'Poznań', country: 'pl', postal: '60-001', lat: 52.4064, lon: 16.9252 },
  { name: 'Berlin', country: 'de', postal: '10115', lat: 52.52, lon: 13.405 },
  { name: 'Hamburg', country: 'de', postal: '20095', lat: 53.5511, lon: 9.9937 },
  { name: 'Praha', country: 'cz', postal: '11000', lat: 50.0755, lon: 14.4378 },
  { name: 'Wien', country: 'at', postal: '1010', lat: 48.2082, lon: 16.3738 },
] as const
