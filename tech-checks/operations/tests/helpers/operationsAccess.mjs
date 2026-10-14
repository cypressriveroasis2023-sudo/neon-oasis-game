import {expect} from '@playwright/test';

// Hard authentication loss quarantines OwnerApp's private subtree. Its former
// child error/retry controls cannot remain mounted or bypass the reload latch.
export async function expectOperationsReloadRequired(frame){
 const alert=frame.locator('.operations-access');
 await expect(alert).toHaveAttribute('role','alert');
 await expect(alert.getByRole('heading',{name:'Operations access needs attention',exact:true})).toBeVisible();
 await expect(alert).toContainText('Your session changed. Reload COS Operations to verify your account and permissions.');
 await expect(frame.getByText('OPERATIONS CONNECTED',{exact:true})).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'Retry Operations access',exact:true})).toHaveCount(0);
}
