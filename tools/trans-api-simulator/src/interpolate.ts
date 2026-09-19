export function expandEnv(input: string, extra: Record<string, string> = {}): string {
  return input.replace(/\$\{([^}]+)\}/g, (_m, expr: string) => {
    const [rawKey, ...fallbackParts] = expr.split(':-')
    const key = rawKey.trim()
    const fallback = fallbackParts.length ? fallbackParts.join(':-') : undefined
    if (Object.prototype.hasOwnProperty.call(extra, key)) return extra[key]
    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] != null) {
      return process.env[key] as string
    }
    return fallback ?? ''
  })
}

export function deepExpandEnv<T>(value: T, extra: Record<string, string> = {}): T {
  if (typeof value === 'string') return expandEnv(value, extra) as T
  if (Array.isArray(value)) return value.map((v) => deepExpandEnv(v, extra)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepExpandEnv(v, extra)
    }
    return out as T
  }
  return value
}

export function parseDurationMs(input: string | number): number {
  if (typeof input === 'number') return input
  const m = String(input).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i)
  if (!m) throw new Error(`[internal] Invalid duration: ${input}`)
  const n = Number(m[1])
  const unit = (m[2] || 'ms').toLowerCase()
  if (unit === 'ms') return Math.round(n)
  if (unit === 's') return Math.round(n * 1000)
  if (unit === 'm') return Math.round(n * 60_000)
  if (unit === 'h') return Math.round(n * 3_600_000)
  throw new Error(`[internal] Invalid duration unit: ${input}`)
}
