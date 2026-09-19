import { expect, expectPlannedPage, legacySections, menuSections, test } from './helpers/fixtures'

test.describe('Logistics page navigation', () => {
  for (const section of menuSections) {
    test(`${section.title} supports direct access, reload and its menu link`, async ({ page, logistics }) => {
      expect(logistics.organizationId).toBeTruthy()
      await page.goto(section.path)
      await expectPlannedPage(page, section)
      await page.reload()
      await expectPlannedPage(page, section)
      await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
      const sidebar = page.getByTestId('sidebar')
      const group = sidebar.getByRole('button', { name: 'Logistics', exact: true })
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
      const link = sidebar.getByRole('link', { name: section.title, exact: true })
      await expect(link).toHaveCount(1)
      await expect(link).toHaveAttribute('href', section.path)
      if (section.tab === 'transports') await expect(link).toHaveClass(/\bbg-muted\b/)
      await link.click()
      await expect(page).toHaveURL(section.tab === 'inbox' ? '/backend/inbox-ops' : section.path)
      await expectPlannedPage(page, section)
      await expect(sidebar.locator('a[href="/backend/logistics"], a[href^="/backend/logistics/"]')).toHaveCount(2)
    })
  }

  test('the inbox redirects and legacy sections still link back', async ({ page, logistics }) => {
    expect(logistics.organizationId).toBeTruthy()
    await page.goto(menuSections[0].path)
    const content = page.getByTestId('logistics-page')
    await expect(page).toHaveURL('/backend/inbox-ops')
    for (const section of legacySections) {
      await page.goto(section.path)
      await expectPlannedPage(page, section)
      await page.reload()
      await expectPlannedPage(page, section)
      await expect(page.getByTestId('sidebar').getByRole('link', { name: section.title, exact: true })).toHaveCount(0)
      await content.getByRole('link', { name: /dashboard/i }).click()
      await expectPlannedPage(page, menuSections[0])
    }
  })
})

test('the inbox destination enforces its own permission', async ({ page, logistics }) => {
  await logistics.grant(['logistics.view'])
  await page.goto('/backend/logistics')
  await expect(page.getByText('You do not have permission to view this page. Please contact your administrator.', { exact: true })).toBeVisible()
})
