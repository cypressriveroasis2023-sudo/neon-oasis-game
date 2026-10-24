import {test,expect} from '@playwright/test';

test('direct packaged entry returns to same-site sign-in without requesting private data',async({page})=>{
  const external=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://127.0.0.1:4173'){external.push(url.pathname);return route.abort('blockedbyclient');}
    if(url.pathname==='/index.html')return route.fulfill({contentType:'text/html',body:'<h1>Synthetic COS sign-in</h1>'});
    if(url.pathname.startsWith('/operations/dist/')){
      const response=await route.fetch({url:url.origin+url.pathname.slice('/operations/dist'.length)});
      return route.fulfill({response});
    }
    return route.continue();
  });
  await page.goto('/operations/dist/index.html#fleet-dashboard');
  await expect(page.getByRole('heading',{name:'Open COS from its sign-in page',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Technician oversight',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Open COS sign-in',exact:true})).toHaveAttribute('href','/index.html');
  expect(external).toEqual([]);
  await page.getByRole('link',{name:'Open COS sign-in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Synthetic COS sign-in'})).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:4173/index.html');
});
