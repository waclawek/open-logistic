export function parseScaledDecimal(value: string, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) {
    throw new RangeError('[internal] Invalid decimal scale')
  }
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  if (!match || (match[2]?.length ?? 0) > scale || value.length > 32) {
    throw new RangeError('[internal] Invalid unsigned decimal')
  }
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] ?? '').padEnd(scale, '0') || '0')
}

export function formatScaledDecimal(value: bigint, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) {
    throw new RangeError('[internal] Invalid decimal scale')
  }
  const sign = value < 0n ? '-' : ''
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0')
  return scale === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}
