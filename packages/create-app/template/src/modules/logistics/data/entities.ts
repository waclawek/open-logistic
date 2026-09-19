import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import type { StoredCargo, StoredLoad, StoredOrder1, StoredOrder2 } from './validators'

@Entity({ abstract: true })
abstract class LogisticsRecord {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'uuid', name: 'tenant_id' })
  tenantId!: string

  @Property({ type: 'uuid', name: 'organization_id' })
  organizationId!: string

  @Property({ type: 'text' })
  reference!: string

  @Property({ type: 'text' })
  customer!: string

  @Property({ type: 'text' })
  origin!: string

  @Property({ type: 'text' })
  destination!: string

  @Property({ type: 'text', name: 'pickup_date' })
  pickupDate!: string

  @Property({ type: 'text', name: 'delivery_date' })
  deliveryDate!: string

  @Property({ type: Date, name: 'created_at' })
  createdAt: Date = new Date()

  @Property({ type: Date, name: 'updated_at' })
  updatedAt: Date = new Date()

  @Property({ type: Date, name: 'deleted_at', nullable: true })
  deletedAt: Date | null = null
}

@Entity({ tableName: 'logistics_offers' })
@Index({ name: 'logistics_offers_scope_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
export class LogisticsOffer extends LogisticsRecord {
  @Property({ type: 'jsonb' })
  cargo!: StoredCargo

  @Property({ type: 'double', name: 'price_eur' })
  priceEur!: number

  @Property({ type: 'text' })
  source!: 'email' | 'exchange'

  @Property({ type: 'text' })
  status!: 'new' | 'review' | 'accepted' | 'rejected'

  @Property({ type: 'uuid', name: 'allocated_transport_id', nullable: true })
  allocatedTransportId?: string | null
}

@Entity({ tableName: 'logistics_transports' })
@Index({ name: 'logistics_transports_scope_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
export class LogisticsTransport extends LogisticsRecord {
  @Property({ type: 'jsonb', name: 'order_1' })
  order1!: StoredOrder1

  @Property({ type: 'jsonb', name: 'order_2', nullable: true })
  order2!: StoredOrder2 | null

  @Property({ type: 'jsonb', name: 'additional_loads' })
  additionalLoads!: StoredLoad[]
}
