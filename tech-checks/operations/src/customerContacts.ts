export type CustomerContact = {id:string;customerId:string;name:string;email:string;phone:string;title:string;isPrimary:boolean;billingContact:boolean};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function readCustomerContacts(data:any,customerId:string):CustomerContact[] {
  if(!uuid(customerId)||data?.customerId!==customerId||!Array.isArray(data.items))throw new Error('Customer contacts returned an incomplete response. Retry to verify the contact records.');
  const seen=new Set<string>();
  for(const item of data.items){
    if(!item||!uuid(item.id)||seen.has(item.id)||item.customerId!==customerId||!['name','email','phone','title'].every(key=>typeof item[key]==='string')||typeof item.isPrimary!=='boolean'||typeof item.billingContact!=='boolean')throw new Error('Customer contact identities or details could not be verified.');
    seen.add(item.id);
  }
  return data.items;
}
export function customerContactInstructions(contact:CustomerContact) {
  return ['Customer contact for this ticket: '+(contact.name||'Name not recorded'),contact.title?'Title: '+contact.title:'',contact.phone?'Phone: '+contact.phone:'',contact.email?'Email: '+contact.email:''].filter(Boolean).join('\n');
}
export function ticketDescriptionWithContact(description:string,contactInstructions:string) {
  return [description.trim(),contactInstructions.trim()].filter(Boolean).join('\n\n');
}
