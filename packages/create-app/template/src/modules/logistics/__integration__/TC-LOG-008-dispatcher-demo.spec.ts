import { expect, test } from './helpers/fixtures'
import { createDispatcherFixtures, readTransport } from './helpers/dispatcher'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('Sales-backed carrier and repeated load decisions survive detail navigation and reload', async ({ page, logistics }) => {
  await logistics.authorizeApi()
  await logistics.prepareSales()
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const transport = await fixtures.createTransport()
    const offers = [await fixtures.createOffer(), await fixtures.createOffer(), await fixtures.createOffer()]
    const rejectedOffer = await fixtures.createOffer(1, 1)
    await page.goto('/backend/logistics/transports')
    const content = page.getByTestId('logistics-page')
    await content.getByPlaceholder('Search orders, customers and routes…').fill(transport.reference)
    await content.getByRole('link', { name: transport.reference, exact: true }).click()
    await expect(page).toHaveURL(`/backend/logistics/transports/${transport.id}`)
    await expect(content.getByTestId('remaining-capacity').getByText(/6[ ,]000 kg/)).toBeVisible()
    await content.getByRole('button', { name: 'Approve carrier', exact: true }).click()
    for (const [index, offer] of offers.entries()) {
      await content.getByRole('button', { name: `Accept additional load: ${offer.reference}`, exact: true }).click()
      await expect(content.getByText(`Order ${index + 3}`, { exact: true })).toBeVisible()
    }
    await expect(content.getByTestId('remaining-capacity').getByText('0 kg', { exact: true })).toBeVisible()
    await expect(content.getByRole('button', { name: `Accept additional load: ${rejectedOffer.reference}`, exact: true })).toBeDisabled()
    await content.getByRole('button', { name: `Reject offer: ${rejectedOffer.reference}`, exact: true }).click()
    await expect(content.getByRole('button', { name: `Reject offer: ${rejectedOffer.reference}`, exact: true })).toHaveCount(0)
    const rejectedResponse = await page.request.get(`/api/logistics/offers?id=${rejectedOffer.id}`)
    expect((await readJsonSafe<{ items: Array<{ status: string }> }>(rejectedResponse))?.items[0]?.status).toBe('rejected')
    await page.reload()
    for (const number of [3, 4, 5]) await expect(content.getByText(`Order ${number}`, { exact: true })).toBeVisible()
    await expect(content.getByTestId('remaining-capacity').getByText('0 kg', { exact: true })).toBeVisible()
    expect((await readTransport(page.request, transport.id)).additionalLoads).toHaveLength(3)
  } finally {
    await fixtures.cleanup()
  }
})
