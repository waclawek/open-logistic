import { buildBoardItem, buildNotifications, formatRoute } from '../lib/routes-board'
import { resolveCityCoords } from '../lib/city-coords'
import type { TransportDetail, TransportOrder, TransportRow } from '../types'

function order(overrides: Partial<TransportOrder> & { id: string }): TransportOrder {
  return {
    orderNumber: `ORD-${overrides.id}`,
    currencyCode: 'EUR',
    status: 'confirmed',
    customerId: null,
    customerName: 'Customer',
    updatedAt: '2026-09-20T08:00:00.000Z',
    fields: {},
    ...overrides,
  }
}

function row(overrides: Partial<TransportRow> & { id: string }): TransportRow {
  return {
    orderNumber: `ORD-${overrides.id}`,
    currencyCode: 'EUR',
    customerName: 'North Goods',
    pickupAddress: 'Warszawa',
    deliveryAddress: 'Berlin',
    pickupWindowStart: null,
    pickupWindowEnd: null,
    cargoPallets: 20,
    cargoWeightKg: 12000,
    clientPrice: 1500,
    carrier: null,
    additionalLoads: { pending: 0, approved: 0, pendingOrderId: null, pendingUpdatedAt: null },
    freeSpace: null,
    updatedAt: '2026-09-20T08:00:00.000Z',
    ...overrides,
  }
}

describe('routes board model', () => {
  test('a row without detail keeps counts and has no version for decisions', () => {
    const item = buildBoardItem(row({ id: 't1', additionalLoads: { pending: 1, approved: 2, pendingOrderId: 'x', pendingUpdatedAt: null } }))
    expect(item.loads).toEqual([])
    expect(item.loadCounts).toEqual({ approved: 2, pending: 1 })
    expect(item.transportVersion).toBeNull()
    expect(item.carrier).toBeNull()
  })

  test('detail turns additional loads into pills and skips rejected ones', () => {
    const detail: TransportDetail = {
      transportVersion: 'v1',
      updatedAt: '2026-09-20T09:00:00.000Z',
      order1: order({ id: 't1', fields: { pickup_address: 'Warszawa', delivery_address: 'Berlin' } }),
      order2: null,
      carrierHistory: [],
      additionalLoads: [
        order({ id: 'l1', status: 'approved', customerName: 'Extra Parts', fields: { pickup_address: 'Poznań', delivery_address: 'Berlin', cargo_pallets: 2, cargo_weight_kg: 1000, client_price: 300 } }),
        order({ id: 'l2', status: 'rejected', customerName: 'Nope' }),
      ],
      freeSpace: { pallets: 11, kg: 11000, limiting: 'pallets' },
    }
    const item = buildBoardItem(row({ id: 't1' }), detail)
    expect(item.loads.map((load) => load.id)).toEqual(['l1'])
    expect(item.loads[0]).toMatchObject({ customerName: 'Extra Parts', pallets: 2, kg: 1000, price: 300, status: 'approved' })
    expect(item.transportVersion).toBe('v1')
    expect(item.updatedAt).toBe('2026-09-20T09:00:00.000Z')
    expect(item.freeSpace).toEqual({ pallets: 11, kg: 11000, limiting: 'pallets' })
  })

  test('notifications list pending carriers and pending loads, newest first, with a fit check', () => {
    const detail: TransportDetail = {
      transportVersion: 'v1',
      updatedAt: '2026-09-20T09:00:00.000Z',
      order1: order({ id: 't1', orderNumber: 'ORD-1', fields: { pickup_address: 'Warszawa', delivery_address: 'Berlin' } }),
      order2: order({ id: 'c1', status: 'pending_approval', customerName: 'Blue Road', updatedAt: '2026-09-20T08:30:00.000Z', fields: { vehicle_type: 'FTL', vehicle_capacity_pallets: 33, vehicle_capacity_kg: 24000, carrier_cost: 900 } }),
      carrierHistory: [],
      additionalLoads: [
        order({ id: 'l1', status: 'pending_approval', customerName: 'Extra Parts', updatedAt: '2026-09-20T08:45:00.000Z', fields: { pickup_address: 'Poznań', delivery_address: 'Berlin', cargo_pallets: 2, cargo_weight_kg: 1000, client_price: 300 } }),
        order({ id: 'l2', status: 'pending_approval', customerName: 'Too Big', updatedAt: '2026-09-20T08:10:00.000Z', fields: { cargo_pallets: 40, cargo_weight_kg: 500 } }),
        order({ id: 'l3', status: 'approved', customerName: 'Done' }),
      ],
      freeSpace: { pallets: 13, kg: 12000, limiting: 'pallets' },
    }
    const notifications = buildNotifications([detail])
    expect(notifications.map((n) => n.id)).toEqual(['t1:load:l1', 't1:carrier:c1', 't1:load:l2'])
    expect(notifications[1]).toMatchObject({ kind: 'carrier', actorName: 'Blue Road', amount: 900, pallets: 33, kg: 24000, transportOrderNumber: 'ORD-1', transportRoute: 'Warszawa → Berlin' })
    expect(notifications[0]).toMatchObject({ kind: 'load', actorName: 'Extra Parts', route: 'Poznań → Berlin', fits: true })
    expect(notifications[2]).toMatchObject({ kind: 'load', actorName: 'Too Big', fits: false })
  })

  test('approved carriers and empty transports produce no notifications', () => {
    const detail: TransportDetail = {
      transportVersion: 'v1',
      updatedAt: '2026-09-20T09:00:00.000Z',
      order1: order({ id: 't1' }),
      order2: order({ id: 'c1', status: 'approved', customerName: 'Silver Truck' }),
      carrierHistory: [],
      additionalLoads: [],
      freeSpace: null,
    }
    expect(buildNotifications([detail])).toEqual([])
  })

  test('formats a route with placeholders', () => {
    expect(formatRoute('Łódź', null)).toBe('Łódź → —')
  })
})

describe('city gazetteer', () => {
  test('finds cities inside free-text addresses, ignoring case and diacritics', () => {
    expect(resolveCityCoords('ul. Długa 5, 80-001 Gdańsk')).toEqual({ lat: 54.352, lng: 18.6466 })
    expect(resolveCityCoords('LODZ, PL')).toEqual({ lat: 51.7592, lng: 19.456 })
    expect(resolveCityCoords('Praha 5')).toEqual({ lat: 50.0755, lng: 14.4378 })
  })

  test('prefers the longer city name and requires whole words', () => {
    expect(resolveCityCoords('Zielona Góra')).toEqual({ lat: 51.9356, lng: 15.5062 })
    expect(resolveCityCoords('Koninko 12')).toBeNull()
    expect(resolveCityCoords(null)).toBeNull()
    expect(resolveCityCoords('Somewhere unknown')).toBeNull()
  })
})
