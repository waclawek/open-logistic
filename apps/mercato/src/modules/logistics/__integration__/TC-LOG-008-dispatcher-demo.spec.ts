import { expect, test } from './helpers/fixtures'
import { createDispatcherFixtures } from './helpers/dispatcher'

test('carrier and additional-order decisions survive navigation and reload', async ({ page, logistics }) => {
  await logistics.authorizeApi()
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const transport = await fixtures.createTransport()
    const offers = [await fixtures.createOffer(), await fixtures.createOffer(), await fixtures.createOffer()]
    const rejectedOffer = await fixtures.createOffer(1, 1)
    await page.goto('/backend/logistics/transports')
    await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByRole('button', { name: `Organization: ${logistics.organizationName}`, exact: true })).toBeVisible()
    const content = page.getByTestId('logistics-page')
    await expect(content.getByRole('tab', { name: 'AI Transports', exact: true })).toHaveAttribute('aria-selected', 'true')
    await content.getByPlaceholder('Search customer, route or order…').fill(transport.reference)
    await content.getByRole('button', { name: `View details: ${transport.reference}`, exact: true }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('remaining-capacity').getByText('6000 kg', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Approve carrier', exact: true }).focus()
    await page.keyboard.press('Control+Enter')
    for (const [index, offer] of offers.entries()) {
      await dialog.getByRole('button', { name: `Accept additional load: ${offer.reference}`, exact: true }).click()
      await expect(dialog.getByText(`Order ${index + 3}`, { exact: true })).toBeVisible()
    }
    await expect(dialog.getByTestId('remaining-capacity').getByText('0 kg', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: `Accept additional load: ${rejectedOffer.reference}`, exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: `Organization: ${logistics.organizationName}`, exact: true })).toBeVisible()
    await content.getByPlaceholder('Search customer, route or order…').fill(transport.reference)
    await content.getByRole('button', { name: `View details: ${transport.reference}`, exact: true }).click()
    dialog = page.getByRole('dialog')
    for (const number of [3, 4, 5]) await expect(dialog.getByText(`Order ${number}`, { exact: true })).toBeVisible()
    await expect(dialog.getByTestId('remaining-capacity').getByText('0 kg', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto('/backend/logistics')
    await expect(page.getByRole('button', { name: `Organization: ${logistics.organizationName}`, exact: true })).toBeVisible()
    await content.getByPlaceholder('Search customer or route…').fill(rejectedOffer.reference)
    await content.getByRole('button', { name: `View details: ${rejectedOffer.reference}`, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Reject offer', exact: true }).click()
    await expect(page.getByRole('dialog').getByText('Rejected', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(page.getByRole('button', { name: `Organization: ${logistics.organizationName}`, exact: true })).toBeVisible()
    await content.getByPlaceholder('Search customer or route…').fill(rejectedOffer.reference)
    await expect(content.getByText('Rejected', { exact: true })).toBeVisible()
  } finally {
    await fixtures.cleanup()
  }
})
