import {test, expect} from '@playwright/test';

test('a pointer click on a TicketSitePicker option selects the customer and keeps the search focused', async ({page}) => {
  await page.goto('/?ticketSitePicker=1');
  const search = page.getByRole('combobox', {name: 'Search customers'});
  await search.fill('Fixture');
  await page.getByRole('option', {name: /Fixture Customer/}).click();
  await expect(search).toHaveValue('Fixture Customer');
  await expect(search).toBeFocused();
  await expect(page.locator('.ticket-customer-selected')).toContainText('Fixture Customer');
});
