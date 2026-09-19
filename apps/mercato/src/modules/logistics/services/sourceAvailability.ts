import { createHash } from 'node:crypto'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { authorizeFeatures, type FeaturePolicySubject } from '@open-mercato/shared/security/featurePolicy'
import { availabilityRangeSchema, type AvailabilityRange } from '../data/availability'
import {
  sourceSubjectSchema, sourceScopeSchema, sourceRowSchema, sourceMasterRowSchema, sourceRuleRowSchema,
  type SourceSubject, type SourceScope, type SourceFailure, type SourceLookupResult,
  type SourceVersion, type ObservedSourceRule, type SourceRuleMembership, type EligibilityResult,
} from '../data/sourceAvailability'
import { evaluateAvailability, type AvailabilityMerger } from '../lib/availability'

export type SourceReadContext = SourceScope & { authorization: FeaturePolicySubject }
export type SourceAvailabilityDependencies = {
  queryEngine?: Pick<QueryEngine, 'query'> | null
  plannerAvailabilityService?: { getMergedAvailabilityWindows: AvailabilityMerger } | null
  now?: () => Date
}

const commonFields = ['id', 'tenant_id', 'organization_id', 'updated_at', 'deleted_at']
const masterFields = [...commonFields, 'is_active', 'availability_rule_set_id']
const ruleFields = [...commonFields, 'subject_type', 'subject_id', 'timezone', 'rrule', 'exdates', 'kind']
const masterModule = { resource: 'resources', member: 'staff' } as const
const masterEntity = { resource: 'resources_resource', member: 'staff_team_member' } as const

class SourceReadFailure extends Error {
  constructor(readonly reasonCode: SourceFailure) { super(`[internal] ${reasonCode}`) }
}

function assertAccess(context: SourceReadContext, subject: SourceSubject, planner: boolean) {
  if (!sourceScopeSchema.safeParse(context).success) throw new SourceReadFailure('invalid_scope')
  if (!sourceSubjectSchema.safeParse(subject).success) throw new SourceReadFailure('invalid_subject')
  const features = ['logistics.view', `${masterModule[subject.subjectType]}.view`]
  if (planner) features.push('planner.view')
  if (!authorizeFeatures(features, context.authorization)) throw new SourceReadFailure('forbidden')
}

function resolveEntity(moduleId: string, entityName: string): string {
  const entity = getEntityIds(false)[moduleId]?.[entityName]
  if (!entity) throw new SourceReadFailure('source_unavailable')
  return entity
}

function failureReason(error: unknown): SourceFailure {
  return error instanceof SourceReadFailure ? error.reasonCode : 'source_unavailable'
}

export function createSourceAvailabilityService(dependencies: SourceAvailabilityDependencies) {
  async function readComplete(
    context: SourceReadContext, entity: string, fields: string[], filters: Record<string, string>,
  ): Promise<Record<string, unknown>[]> {
    if (!dependencies.queryEngine) throw new SourceReadFailure('source_unavailable')
    const rows: Record<string, unknown>[] = []
    const seen = new Set<string>()
    let expectedTotal: number | undefined
    for (let page = 1; ; page += 1) {
      const result = await dependencies.queryEngine.query<Record<string, unknown>>(entity, {
        tenantId: context.tenantId, organizationId: context.organizationId,
        fields, filters: { ...filters, tenant_id: context.tenantId, organization_id: context.organizationId },
        page: { page, pageSize: 100 }, sort: [{ field: 'id', dir: SortDir.Asc }],
        includeCustomFields: false, includeExtensions: false, withDeleted: false, skipAutoReindex: true,
      })
      if (!Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page || result.pageSize !== 100
        || !Array.isArray(result.items) || result.items.length > 100
        || result.meta?.partialIndexWarning || result.meta?.listCountCapWarning || result.meta?.encryptedSortRowCapWarning
        || (expectedTotal !== undefined && expectedTotal !== result.total)) {
        throw new SourceReadFailure('incomplete_source')
      }
      expectedTotal = result.total
      for (const row of result.items) {
        const parsed = sourceRowSchema.safeParse(row)
        if (!parsed.success || parsed.data.tenant_id !== context.tenantId
          || parsed.data.organization_id !== context.organizationId || parsed.data.deleted_at !== null
          || Object.entries(filters).some(([key, value]) => row[key] !== value)) {
          throw new SourceReadFailure('invalid_source')
        }
        if (seen.has(parsed.data.id)) throw new SourceReadFailure('incomplete_source')
        seen.add(parsed.data.id)
        rows.push(row)
      }
      if (rows.length > expectedTotal) throw new SourceReadFailure('incomplete_source')
      if (rows.length === expectedTotal) return rows
      if (result.items.length !== 100) throw new SourceReadFailure('incomplete_source')
    }
  }

  async function readMaster(context: SourceReadContext, subject: SourceSubject) {
    const entity = resolveEntity(masterModule[subject.subjectType], masterEntity[subject.subjectType])
    const rows = await readComplete(context, entity, masterFields, { id: subject.subjectId })
    if (!rows.length) throw new SourceReadFailure('source_missing')
    const parsed = sourceMasterRowSchema.safeParse(rows[0])
    if (rows.length !== 1 || !parsed.success) throw new SourceReadFailure('invalid_source')
    return { entity, row: parsed.data }
  }

  async function lookupSource(context: SourceReadContext, subject: SourceSubject): Promise<SourceLookupResult> {
    try {
      assertAccess(context, subject, false)
      const { row } = await readMaster(context, subject)
      return { status: 'found', source: {
        ...subject, updatedAt: row.updated_at, isActive: row.is_active, linkedRuleSetId: row.availability_rule_set_id,
      } }
    } catch (error) { return { status: 'unknown', reasonCode: failureReason(error) } }
  }

  async function evaluate(context: SourceReadContext, subject: SourceSubject, range: AvailabilityRange): Promise<EligibilityResult> {
    const sources: SourceVersion[] = []
    const memberships: SourceRuleMembership[] = []
    const rules: ObservedSourceRule[] = []
    let linkedRuleSetId: string | null = null
    const parsedRange = availabilityRangeSchema.safeParse(range)
    const rangeStart = parsedRange.success ? parsedRange.data.start.toISOString() : null
    const rangeEnd = parsedRange.success ? parsedRange.data.end.toISOString() : null
    const finish = (status: EligibilityResult['status'], reasonCode: EligibilityResult['reasonCode'],
      ruleIds: string[] = [], windows: EligibilityResult['windows'] = []): EligibilityResult => {
      sources.sort((left, right) => `${left.entityType}:${left.id}`.localeCompare(`${right.entityType}:${right.id}`))
      rules.sort((left, right) => left.id.localeCompare(right.id))
      memberships.sort((left, right) => `${left.subjectType}:${left.subjectId}`.localeCompare(`${right.subjectType}:${right.subjectId}`))
      const observation = { status, reasonCode, rangeStart, rangeEnd, sources, rules, memberships, linkedRuleSetId, ruleIds, windows }
      const fingerprint = createHash('sha256').update(JSON.stringify({
        tenantId: context.tenantId, organizationId: context.organizationId,
        subjectType: subject.subjectType, subjectId: subject.subjectId, ...observation,
      })).digest('hex')
      return { ...observation, checkedAt: (dependencies.now?.() ?? new Date()).toISOString(), fingerprint }
    }
    try {
      assertAccess(context, subject, true)
      if (!parsedRange.success) return finish('unknown', 'invalid_range')
      const master = await readMaster(context, subject)
      sources.push({ entityType: master.entity, id: master.row.id, updatedAt: master.row.updated_at })
      linkedRuleSetId = master.row.availability_rule_set_id
      if (!master.row.is_active) return finish('ineligible', 'source_disabled')
      const ruleEntity = resolveEntity('planner', 'planner_availability_rule')
      const readRules = async (subjectType: SourceRuleMembership['subjectType'], subjectId: string) => {
        const rows = await readComplete(context, ruleEntity, ruleFields, { subject_type: subjectType, subject_id: subjectId })
        memberships.push({ subjectType, subjectId, ruleIds: rows.map((row) => String(row.id)).sort() })
        return rows
      }
      let selected = await readRules(subject.subjectType, subject.subjectId)
      if (!selected.length && linkedRuleSetId) {
        const ruleSetEntity = resolveEntity('planner', 'planner_availability_rule_set')
        const ruleSets = await readComplete(context, ruleSetEntity, commonFields, { id: linkedRuleSetId })
        if (ruleSets.length !== 1) throw new SourceReadFailure('source_missing')
        const ruleSet = sourceRowSchema.parse(ruleSets[0])
        sources.push({ entityType: ruleSetEntity, id: ruleSet.id, updatedAt: ruleSet.updated_at })
        selected = await readRules('ruleset', linkedRuleSetId)
      }
      const invalidRuleIds: string[] = []
      for (const row of selected) {
        const version = sourceRowSchema.parse(row)
        sources.push({ entityType: ruleEntity, id: version.id, updatedAt: version.updated_at })
        const parsed = sourceRuleRowSchema.safeParse(row)
        if (!parsed.success) {
          invalidRuleIds.push(version.id)
          continue
        }
        const rule = parsed.data
        rules.push({ id: rule.id, subjectType: rule.subject_type, subjectId: rule.subject_id,
          updatedAt: rule.updated_at, timezone: rule.timezone, rrule: rule.rrule,
          exdates: [...rule.exdates].sort(), kind: rule.kind })
      }
      if (invalidRuleIds.length) return finish('unknown', 'unsupported_rule', invalidRuleIds.sort())
      const merger = dependencies.plannerAvailabilityService
      const result = evaluateAvailability(rules, parsedRange.data,
        merger ? (params) => merger.getMergedAvailabilityWindows(params) : undefined)
      return finish(result.status, result.reasonCode, result.ruleIds, result.windows)
    } catch (error) { return finish('unknown', failureReason(error)) }
  }

  return { lookupSource, evaluate }
}
