import {test, expect} from '@playwright/test';

const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const customerId = '11111111-1111-4111-8111-111111111111';
const siteId = '22222222-2222-4222-8222-222222222222';

test('a pointer click on a TicketSitePicker option selects the customer and keeps the search focused', async ({page}) => {
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/ticket-site-picker-fixture') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/?ticketSitePicker=1"></iframe><script>addEventListener('message',event=>{const frame=document.querySelector('iframe');if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,role:'owner',accessToken:'synthetic-owner-only'},location.origin);})</script>`,
      });
    }
    if (url.origin === origin) return route.continue();
    if (url.href !== edge) return route.abort('blockedbyclient');
    const headers = {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type'};
    if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const body = request.postDataJSON();
    if (body.method !== 'GET') return route.fulfill({status: 400, headers, json: {error: 'Synthetic writes disabled'}});
    const data = body.path === '/api/customers'
      ? {items: [{id: customerId, name: 'Fixture Customer', legalName: 'Fixture Customer LLC', customerNumber: 'FX-01', status: 'active'}]}
      : body.path === '/api/sites'
        ? {items: [{id: siteId, name: 'Fixture Site', customerId, status: 'active', addressLine1: '100 Fixture Street', city: 'Katy', stateRegion: 'TX', postalCode: '77494', country: 'US'}]}
        : {items: []};
    return route.fulfill({headers, json: data});
  });
  await page.goto('/ticket-site-picker-fixture');
  const app = page.frameLocator('iframe');
  const search = app.getByRole('combobox', {name: 'Search customers'});
  await search.fill('Fixture');
  await app.getByRole('option', {name: /Fixture Customer/}).click();
  await expect(search).toHaveValue('Fixture Customer');
  await expect(search).toBeFocused();
  await expect(app.locator('.ticket-customer-selected')).toContainText('Fixture Customer');
});
