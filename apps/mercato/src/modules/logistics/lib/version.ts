import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { utcTimestampSchema } from '../data/validators'

export function requireRecordVersion(entityType: string, record: { id: string; updatedAt: Date }, expected: string): void {
  utcTimestampSchema.parse(expected)
  if (!Number.isFinite(record.updatedAt.getTime())) throw new Error('[internal] Invalid stored logistics version')
  assertOptimisticLock({ resourceKind: entityType, resourceId: record.id, expected, current: record.updatedAt, envValue: 'all' })
}

export function nextRecordVersion(current: Date, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), current.getTime() + 1))
}
