// Exact presentation-only changes to legacy-host test entry navigation.
const changes=[
  [
    "import { test, expect } from '@playwright/test';",
    "import { test, expect } from '@playwright/test';\nimport {openWorkspace} from './navigation-helper.mjs';",
    1
  ],
  [
    "async function openChecks(frame){\n  await frame.getByRole('button',{name:'More',exact:true}).click();\n  const menu=frame.getByRole('dialog',{name:'Operations navigation'});\n  await expect(menu.getByRole('button',{name:'Tech Checks',exact:true})).toHaveCount(1);\n  await expect(menu.getByRole('button',{name:'Accounts & Permissions',exact:true})).toHaveCount(0);\n  await menu.getByRole('button',{name:'Tech Checks',exact:true}).click();\n  await expect(frame.getByRole('heading',{name:'Tech Checks',exact:true})).toBeVisible();\n}",
    "async function openChecks(frame){\n  await openWorkspace(frame,'Tech Check');\n  await expect(frame.getByRole('heading',{name:'Tech Check',exact:true})).toBeVisible();\n}\nasync function openCheckTool(hub,label){\n  const button=hub.getByRole('button',{name:new RegExp('^'+label)});\n  if(!await button.isVisible())await hub.locator('summary').filter({hasText:'Manage Tech Checks'}).click();\n  await button.click();\n}",
    1
  ],
  [
    "name:/^IT Preparation/",
    "name:/^IT check in \\/ out/",
    1
  ],
  [
    "name:/^Service Truck/",
    "name:/^Service handoffs/",
    1
  ],
  [
    "'dispatch jobs are in Operations'",
    "'Service jobs are created in mHelp.'",
    1
  ],
  [
    "await hub.getByRole('button',{name:new RegExp('^'+label)}).click();",
    "await openCheckTool(hub,label);",
    1
  ],
  [
    "await hub.getByRole('button',{name:/^Technician accounts/}).click();",
    "await openCheckTool(hub,'Technician accounts');",
    1
  ],
  [
    "await page.locator('#cosOperationsReturn').click();await expect(frame.getByRole('heading',{name:'Tech Checks',exact:true})).toBeVisible();",
    "await page.locator('#cosOperationsReturn').click();await expect(frame.getByRole('heading',{name:'Tech Check',exact:true})).toBeVisible();",
    1
  ],
  [
    "const {frame}=await mount(page,'/tech-checks/#tech-checks');\n  await expect(frame.getByRole('heading',{name:'Tech Checks',exact:true})).toBeVisible();",
    "const {frame}=await mount(page,'/tech-checks/#tech-checks');\n  await expect(frame.getByRole('heading',{name:'Tech Check',exact:true})).toBeVisible();",
    1
  ],
  [
    "await frame.getByRole('button',{name:'More',exact:true}).click();\n  await frame.getByRole('dialog',{name:'Operations navigation'}).getByRole('button',{name:'Overview',exact:true}).click();",
    "await openWorkspace(frame,'Today');",
    1
  ]
];
function replace(source,from,to,count){
 const found=source.split(from).length-1;
 if(found!==count)throw new Error('Tech Check test source changed; refusing automatic adaptation');
 return source.replaceAll(from,to);
}
export function adaptTechCheckHost(source){return changes.reduce((text,[from,to,count])=>replace(text,from,to,count),source);}
export function restoreTechCheckHost(source){return [...changes].reverse().reduce((text,[from,to,count])=>replace(text,to,from,count),source);}
