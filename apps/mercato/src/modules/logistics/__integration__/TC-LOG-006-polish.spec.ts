import { expect, sections, test } from './helpers/fixtures'
import pl from '../i18n/pl.json' with { type: 'json' }

const polishTitles = [
  'Panel dyspozytora',
  'Panel dyspozytora',
  pl['logistics.proposalsDisruptions.title'],
  'Zlecenia transportowe',
  'Pojazdy / kierowcy',
  'Przejazdy i trasy',
  'Mapa floty',
  'Statystyki',
]

test('Polish logistics pages and the ordered navigation entries are translated', async ({ page, logistics, baseURL }) => {
  expect(logistics.organizationId).toBeTruthy()
  await page.context().addCookies([{ name: 'locale', value: 'pl', url: baseURL!, sameSite: 'Lax' }])
  for (const [index, section] of sections.entries()) {
    await page.goto(section.path)
    const content = page.getByTestId('logistics-page')
    if ('tab' in section) {
      await expect(content.getByRole('heading', { name: 'Panel dyspozytora', exact: true })).toBeVisible()
      await expect(content.getByRole('tab', { name: pl['logistics.dispatcher.inbox'], exact: true })).toBeVisible()
      await expect(content.getByRole('tab', { name: pl['logistics.dispatcher.transports'], exact: true })).toBeVisible()
      await expect(content.getByRole('tab', { name: pl[`logistics.dispatcher.${section.tab}`], exact: true })).toHaveAttribute('aria-selected', 'true')
    } else if (section.path === '/backend/logistics/proposals-disruptions') {
      await expect(content.getByRole('heading', { name: polishTitles[index], exact: true })).toBeVisible()
      await expect(content.getByTestId('logistics-agent-inbox')).toBeVisible()
    } else {
      await expect(content.getByRole('heading', { name: polishTitles[index], exact: true })).toBeVisible()
      await expect(content.getByText('Funkcja planowana', { exact: true })).toBeVisible()
    }
  }
  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar.getByRole('button', { name: 'Logistyka', exact: true })).toHaveCount(1)
  const logisticsLinks = sidebar.locator('a[href="/backend/logistics"], a[href^="/backend/logistics/"]')
  await expect(logisticsLinks).toHaveText([
    pl['logistics.dispatcher.inbox'],
    pl['logistics.dispatcher.transports'],
    pl['logistics.proposalsDisruptions.title'],
  ])
})
