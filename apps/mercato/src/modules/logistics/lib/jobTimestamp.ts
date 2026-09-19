const timestampFields = new Set([
  'pickupWindowStart', 'pickupWindowEnd', 'deliveryWindowStart', 'deliveryWindowEnd',
  'acceptedAt', 'firstAssignedAt', 'terminalAt', 'createdAt', 'updatedAt',
])

export function jobTimestampValue(property: string, value: unknown): unknown {
  if (!timestampFields.has(property) || value === null) return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value)) {
    throw new Error('[internal] Invalid stored job timestamp')
  }
  return new Date(value).toISOString()
}
