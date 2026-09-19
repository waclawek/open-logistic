import { z } from 'zod'
import { availabilityResultSchema } from './availability'

export const sourceSubjectSchema = z.object({
  subjectType: z.enum(['resource', 'member']),
  subjectId: z.string().uuid(),
}).strict()

export const sourceScopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const timestampSchema = z.union([z.date(), z.string().datetime({ offset: true })])
  .transform((value) => new Date(value).toISOString())

export const sourceRowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable(),
})

export const sourceMasterRowSchema = sourceRowSchema.extend({
  is_active: z.boolean(),
  availability_rule_set_id: z.string().uuid().nullable(),
})

export const sourceRuleRowSchema = sourceRowSchema.extend({
  subject_type: z.enum(['resource', 'member', 'ruleset']),
  subject_id: z.string().uuid(),
  timezone: z.string().min(1).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
  }),
  rrule: z.string(),
  exdates: z.array(z.string()),
  kind: z.enum(['availability', 'unavailability']),
})

export const sourceVersionSchema = z.object({
  entityType: z.string(), id: z.string().uuid(), updatedAt: z.string().datetime(),
})

export const observedSourceRuleSchema = z.object({
  id: z.string().uuid(),
  subjectType: z.enum(['resource', 'member', 'ruleset']),
  subjectId: z.string().uuid(),
  timezone: z.string(), rrule: z.string(), exdates: z.array(z.string()),
  kind: z.enum(['availability', 'unavailability']), updatedAt: z.string().datetime(),
})

export const sourceRuleMembershipSchema = z.object({
  subjectType: z.enum(['resource', 'member', 'ruleset']),
  subjectId: z.string().uuid(), ruleIds: z.array(z.string().uuid()),
})

export const sourceFailureSchema = z.enum([
  'invalid_subject', 'invalid_scope', 'forbidden', 'source_unavailable', 'source_missing',
  'source_disabled', 'invalid_source', 'incomplete_source',
])

export const eligibilityResultSchema = availabilityResultSchema.extend({
  reasonCode: z.union([availabilityResultSchema.shape.reasonCode, sourceFailureSchema]),
  checkedAt: z.string().datetime(),
  rangeStart: z.string().datetime().nullable(),
  rangeEnd: z.string().datetime().nullable(),
  sources: z.array(sourceVersionSchema),
  rules: z.array(observedSourceRuleSchema),
  memberships: z.array(sourceRuleMembershipSchema),
  linkedRuleSetId: z.string().uuid().nullable(),
  fingerprint: z.string(),
})

export type SourceSubject = z.infer<typeof sourceSubjectSchema>
export type SourceScope = z.infer<typeof sourceScopeSchema>
export type SourceVersion = z.infer<typeof sourceVersionSchema>
export type ObservedSourceRule = z.infer<typeof observedSourceRuleSchema>
export type SourceRuleMembership = z.infer<typeof sourceRuleMembershipSchema>
export type SourceFailure = z.infer<typeof sourceFailureSchema>
export type EligibilityResult = z.infer<typeof eligibilityResultSchema>
export type SourceMaster = SourceSubject & {
  updatedAt: string
  isActive: boolean
  linkedRuleSetId: string | null
}
export type SourceLookupResult =
  | { status: 'found'; source: SourceMaster }
  | { status: 'unknown'; reasonCode: SourceFailure }
