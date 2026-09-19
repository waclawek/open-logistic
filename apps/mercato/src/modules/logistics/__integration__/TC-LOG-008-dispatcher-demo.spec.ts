import type { Request } from '@playwright/test'
import { expect, test } from './helpers/fixtures'

test('demo offers and transports support review, capacity decisions and reset', async ({ page, logistics }) => {
  expect(logistics.organizationId).toBeTruthy()
  const logisticsWrites: string[] = []
  const captureWrite = (request: Request) => {
    if (/^\/api\/logistics(?:\/|$)/.test(new URL(request.url()).pathname)
      && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) logisticsWrites.push(request.url())
  }
  page.on('request', captureWrite)
  try {
    await page.goto('/backend/logistics')
    const content = page.getByTestId('logistics-page')
    await expect(content.getByRole('tab')).toHaveCount(2)
    await expect(content.getByRole('tab', { name: 'AI Inbox', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(content.getByText('Sample data. Decisions are simulated in this session and reset when you refresh the page.', { exact: true })).toBeVisible()
    const offersSearch = content.getByPlaceholder('Search customer or route…')
    await offersSearch.fill('berlin')
    await expect(content.getByRole('button', { name: /^View details:/ })).toHaveCount(1)
    await content.getByRole('button', { name: /^View details:/ }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Offer details/ })).toBeVisible()
    await expect(dialog.getByText('Offer preview. Connecting offers to real orders is the next stage.', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(content.getByRole('button', { name: /^View details:/ })).toBeFocused()

    await content.getByRole('tab', { name: 'AI Transports', exact: true }).click()
    const transportsSearch = content.getByPlaceholder('Search customer, route or order…')
    await transportsSearch.fill('north goods')
    await content.getByRole('button', { name: /^View details:/ }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Order 1 · Customer order', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Order 2 · Carrier order', { exact: true })).toBeVisible()
    const remaining = dialog.getByTestId('remaining-capacity')
    await expect(remaining.getByText('12000 kg', { exact: true })).toBeVisible()
    await expect(remaining.getByText('13 pallets', { exact: true })).toBeVisible()
    const acceptAdditional = dialog.getByRole('button', { name: 'Accept demo additional load', exact: true })
    await expect(acceptAdditional).toBeDisabled()
    await dialog.getByRole('button', { name: 'Approve carrier', exact: true }).focus()
    await page.keyboard.press('Control+Enter')
    await expect(acceptAdditional).toBeEnabled()
    await acceptAdditional.click()
    await expect(remaining.getByText('10000 kg', { exact: true })).toBeVisible()
    await expect(remaining.getByText('9 pallets', { exact: true })).toBeVisible()
    await expect(acceptAdditional).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await content.getByRole('button', { name: 'Reset demo', exact: true }).click()
    await expect(transportsSearch).toHaveValue('')
    await transportsSearch.fill('north goods')
    await content.getByRole('button', { name: /^View details:/ }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Approve carrier', exact: true })).toBeEnabled()
    await expect(page.getByRole('dialog').getByTestId('remaining-capacity').getByText('13 pallets', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(content.getByRole('tab', { name: 'AI Inbox', exact: true })).toHaveAttribute('aria-selected', 'true')
    expect(logisticsWrites).toEqual([])
  } finally {
    page.off('request', captureWrite)
  }
})
