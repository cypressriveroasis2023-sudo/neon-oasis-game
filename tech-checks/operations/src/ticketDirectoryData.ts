import { records, type Row } from './directoryData.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A missing association/status is unavailable data, never an invitation to create a replacement site. */
export function readTicketDirectory(customerData:unknown,siteData:unknown):{customers:Row[];sites:Row[]} {
  const customers=records(customerData,'Customers'),sites=records(siteData,'Sites');
  for(const [label,rows] of [['Customer',customers],['Site',sites]] as const){
    if(rows.some(row=>!['active','inactive','archived'].includes(row.status)))throw new Error(label+' status could not be verified. Retry the customer and site directory.');
    if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error(label+' identities are inconsistent. Retry the customer and site directory.');
  }
  const customerIds=new Set(customers.map(row=>row.id));
  if(sites.some(site=>typeof site.customerId!=='string'||!uuid.test(site.customerId)||!customerIds.has(site.customerId)))throw new Error('Site customer associations could not be verified. Retry the customer and site directory.');
  return {customers:customers.filter(row=>row.status==='active'),sites:sites.filter(row=>row.status==='active')};
}
