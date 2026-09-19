import { MetadataStorage } from '@mikro-orm/core'
import { DriverProfile, TransportJob, VehicleProfile } from '../data/entities'
import { defaultEncryptionMaps } from '../encryption'
import { extensions } from '../data/extensions'

function metadata(entity: typeof DriverProfile | typeof VehicleProfile | typeof TransportJob) {
  const path = (entity as unknown as Record<symbol, string>)[MetadataStorage.PATH_SYMBOL]
  return MetadataStorage.getMetadata(entity.name, path)
}

describe('logistics persistence boundaries', () => {
  it.each([DriverProfile, VehicleProfile, TransportJob])('scopes and versions %s without master ORM relationships', (entity) => {
    const model = metadata(entity)
    expect(model.properties.tenantId.type).toBe('uuid')
    expect(model.properties.organizationId.type).toBe('uuid')
    expect(model.properties.updatedAt.onUpdate).toEqual(expect.any(Function))
    const sameMillisecond = new Date(Date.now() + 10000)
    const refreshVersion = model.properties.updatedAt.onUpdate as (entity: { updatedAt: Date }) => Date
    expect(refreshVersion({ updatedAt: sameMillisecond }).getTime()).toBeGreaterThan(sameMillisecond.getTime())
    expect(Object.values(model.properties).every((property) => !property.entity)).toBe(true)
    expect(model.uniques.every((constraint) => {
      const keys = constraint.properties as string[]
      return keys.includes('tenantId') && keys.includes('organizationId')
    })).toBe(true)
  })

  it('requires a registration lookup hash even when encryption is disabled', () => {
    const vehicle = metadata(VehicleProfile)
    expect(vehicle.properties.registrationHash.nullable).not.toBe(true)
    expect(vehicle.uniques).toContainEqual(expect.objectContaining({
      properties: ['tenantId', 'organizationId', 'registrationHash'],
    }))
    expect(new VehicleProfile().dispatchEnabled).toBe(false)
    expect(new VehicleProfile().ledgerRevision).toBe(0)
    expect(new DriverProfile().dispatchEnabled).toBe(false)
  })

  it('preserves decimal precision and unaccepted state', () => {
    expect(metadata(TransportJob).properties.weightKg).toMatchObject({ type: 'numeric', precision: 12, scale: 3 })
    expect(metadata(VehicleProfile).properties.maxPayloadKg).toMatchObject({ type: 'numeric', precision: 12, scale: 3 })
    expect(new TransportJob()).toMatchObject({ status: 'draft', acceptedAt: null, firstAssignedAt: null, terminalAt: null })
  })

  it('encrypts complete sensitive snapshots and keeps exact registration lookup', () => {
    const maps = new Map(defaultEncryptionMaps.map((map) => [map.entityId, map.fields]))
    expect(maps.get('logistics:vehicle_profile')).toEqual([
      { field: 'registration', hashField: 'registration_hash' }, { field: 'last_known_place' },
    ])
    expect(maps.get('logistics:driver_profile')).toEqual([{ field: 'dispatcher_notes' }])
    expect(maps.get('logistics:transport_job')?.map((field) => field.field)).toEqual([
      'customer_name_snapshot', 'customer_reference', 'cargo_description', 'pickup_place', 'delivery_place', 'notes', 'cancellation_reason',
    ])
  })

  it('declares owned profile extensions with actual tables', () => {
    expect(extensions).toEqual([
      { base: 'resources:resources_resource', extension: 'logistics:vehicle_profile', join: { baseKey: 'id', extensionKey: 'resource_id' }, table: 'logistics_vehicle_profiles', cardinality: 'one-to-one' },
      { base: 'staff:staff_team_member', extension: 'logistics:driver_profile', join: { baseKey: 'id', extensionKey: 'staff_member_id' }, table: 'logistics_driver_profiles', cardinality: 'one-to-one' },
    ])
  })
})
