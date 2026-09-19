import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { sanitizeCustomFieldHtmlRichTextValuesServer } from '@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer'
import { validateCustomFieldValuesServer } from '@open-mercato/core/modules/entities/lib/validation'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { normalizeCustomFieldResponse, normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

export type TransactionalCustomFieldsOptions = {
  em: EntityManager
  container: Pick<AwilixContainer, 'resolve'>
  entityId: `logistics:${string}`
  recordId: string
  scope: { tenantId: string; organizationId: string }
  values?: Record<string, unknown> | null
  validationErrorMessage: string
}

/**
 * Call with an authorized record, trusted scope and the receipted command's active EM.
 * Flush parent scalar changes first; this helper queries definitions and flushes values.
 * Values use bare field keys. The caller supplies a translated validation message,
 * owns rollback on failure, and emits CRUD/index/cache effects after the outer commit.
 */
export async function setTransactionalCustomFields(options: TransactionalCustomFieldsOptions): Promise<void> {
  const { em, container, entityId, recordId, scope, values } = options
  if (!em.isInTransaction()) throw new Error('[internal] Logistics custom fields require an active transaction')
  if (!scope.tenantId || !scope.organizationId) throw new Error('[internal] Logistics custom fields require a trusted tenant and organization')
  if (!values || Object.keys(values).length === 0) return

  const scoped = { entityId, tenantId: scope.tenantId, organizationId: scope.organizationId }
  const sanitizedValues = await sanitizeCustomFieldHtmlRichTextValuesServer(em, {
    ...scoped,
    values: normalizeCustomFieldValues(values),
  })
  const prepared = normalizeCustomFieldResponse(sanitizedValues)
  if (prepared) {
    const result = await validateCustomFieldValuesServer(em, { ...scoped, values: prepared })
    if (!result.ok) {
      const error = badRequest(options.validationErrorMessage)
      error.body.fields = result.fieldErrors
      throw error
    }
  }

  let encryptionService: TenantDataEncryptionService | null
  try {
    encryptionService = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  } catch {
    encryptionService = null
  }
  await setRecordCustomFields(em, { ...scoped, recordId, values: sanitizedValues, encryptionService })
}
