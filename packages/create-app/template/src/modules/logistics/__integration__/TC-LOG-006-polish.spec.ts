import { expect, legacySections, menuSections, test } from './helpers/fixtures'
import pl from '../i18n/pl.json' with { type: 'json' }

const polishTitles = ['Zlecenia transportowe', 'Pojazdy / kierowcy', 'Przejazdy i trasy', 'Mapa floty', 'Statystyki', 'Propozycje i zakłócenia']

test('Polish transport and legacy pages preserve translated navigation', async ({ page, logistics, baseURL }) => {
  expect(logistics.organizationId).toBeTruthy()
  await page.context().addCookies([{ name: 'locale', value: 'pl', url: baseURL!, sameSite: 'Lax' }])
  await page.goto(menuSections[1].path)
  await expect(page.getByTestId('logistics-page').getByRole('heading', { name: pl['logistics.dispatcher.transports'], exact: true })).toBeVisible()
  for (const [index, section] of legacySections.entries()) {
    await page.goto(section.path)
    const content = page.getByTestId('logistics-page')
    await expect(content.getByRole('heading', { name: polishTitles[index], exact: true })).toBeVisible()
    await expect(content.getByText('Funkcja planowana', { exact: true })).toBeVisible()
  }
  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar.getByRole('button', { name: 'Logistyka', exact: true })).toHaveCount(1)
  const logisticsLinks = sidebar.locator('a[href="/backend/logistics"], a[href^="/backend/logistics/"]')
  await expect(logisticsLinks).toHaveText([pl['logistics.dispatcher.inbox'], pl['logistics.dispatcher.transports']])
})
