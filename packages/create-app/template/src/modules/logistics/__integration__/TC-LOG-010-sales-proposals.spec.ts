import { expect, test } from './helpers/fixtures'
import { createDispatcherFixtures, decideTransport, readTransport, versionHeaders } from './helpers/dispatcher'

export const integrationMeta = { dependsOnModules: ['sales', 'customers'] }

test('rejected carrier remains in history while replacement and pending loads use Sales orders', async ({ page, logistics }) => {
  await logistics.authorizeApi()
  await logistics.prepareSales()
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    let transport = await decideTransport(page.request, await fixtures.createTransport(), 'reject_carrier')
    const originalCarrierId = transport.carrierHistory[0]?.id
    expect(originalCarrierId).toBeTruthy()
    const replacement = await page.request.post(`/api/logistics/transports/${transport.id}/carrier-proposals`, {
      headers: versionHeaders(transport), data: {
        carrierName: 'QA Replacement carrier', carrierCost: 900, vehicleType: 'FTL',
        vehicleCapacityPallets: 32, vehicleCapacityKg: 18000, vehiclePlate: 'QA-REPLACEMENT',
      },
    })
    expect(replacement.ok(), await replacement.text()).toBe(true)
    transport = await readTransport(page.request, transport.id)
    expect(transport.order2?.status).toBe('pending_approval')
    expect(transport.order2?.id).not.toBe(originalCarrierId)
    expect(await logistics.readSalesOrder(transport.order2!.id)).toMatchObject({ id: transport.order2!.id })
    transport = await decideTransport(page.request, transport, 'approve_carrier')
    const propose = async () => {
      const response = await page.request.post(`/api/logistics/transports/${transport.id}/additional-loads`, {
        headers: versionHeaders(transport), data: {
          customerName: 'QA Additional customer', pickupAddress: 'Warszawa', deliveryAddress: 'Berlin',
          cargoPallets: 4, cargoWeightKg: 2000, clientPrice: 500,
        },
      })
      expect(response.ok(), await response.text()).toBe(true)
      transport = await readTransport(page.request, transport.id)
      return transport.additionalLoads.find((order) => order.status === 'pending_approval')!
    }
    const rejected = await propose()
    expect(rejected).toBeTruthy()
    const rejectResponse = await page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(transport), data: { action: 'reject_load', orderId: rejected.id },
    })
    expect(rejectResponse.ok(), await rejectResponse.text()).toBe(true)
    transport = await readTransport(page.request, transport.id)
    expect(transport.additionalLoads.find((order) => order.id === rejected.id)?.status).toBe('rejected')
    expect(transport.freeSpace).toMatchObject({ kg: 6000, pallets: 12 })
    const accepted = await propose()
    const acceptResponse = await page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(transport), data: { action: 'accept_load', orderId: accepted.id },
    })
    expect(acceptResponse.ok(), await acceptResponse.text()).toBe(true)
    transport = await readTransport(page.request, transport.id)
    expect(transport.additionalLoads.find((order) => order.id === accepted.id)?.status).toBe('approved')
    expect(transport.freeSpace).toMatchObject({ kg: 4000, pallets: 8 })
    expect(transport.carrierHistory.map((order) => order.id)).toContain(originalCarrierId)
    const filtered = await page.request.get('/api/logistics/transports?carrierStatus=none')
    expect(filtered.ok()).toBe(true)
    expect((await filtered.json()).items).toEqual([])
  } finally {
    await fixtures.cleanup()
  }
})
