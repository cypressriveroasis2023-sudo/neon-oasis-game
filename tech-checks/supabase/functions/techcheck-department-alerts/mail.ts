// Deterministic internal alerts. No Google credentials or personally supplied
// recipient lists are accepted from the phone; addresses are server-owned.
export const MANAGER_EMAIL='jmartin@camerasonsite.com';

export function verifiedStaffEmail(input:unknown):string|null{
 const email=String(input||'').trim().toLowerCase();
 return /^[^@\s]+@camerasonsite[.]com$/.test(email)?email:null;
}
export function base64(bytes:Uint8Array):string{
 let binary='';
 for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(binary);
}
export function makeRawMail(
 alert:{id:string;recipient_email:string;subject:string;body:string}
):string{
 const recipient=verifiedStaffEmail(alert.recipient_email);
 if(!recipient)throw new Error('Recipient is not an authorized company address.');
 if(!/^[0-9a-f-]{36}$/i.test(alert.id))throw new Error('Invalid alert identity.');
 const encoder=new TextEncoder();
 const safeSubject=alert.subject.replace(/[\r\n]/g,' ').slice(0,180);
 const cleanBody=alert.body.replace(/\r/g,'').slice(0,4000);
 const subject=base64(encoder.encode(safeSubject));
 const content=base64(encoder.encode(cleanBody));
 const mime=
   'From: Cameras Onsite TechCheck <'+MANAGER_EMAIL+'>\r\n'+
   'To: '+recipient+'\r\n'+
   'Subject: =?UTF-8?B?'+subject+'?=\r\n'+
   'Message-ID: <cos-department-'+alert.id+'@camerasonsite.com>\r\n'+
   'MIME-Version: 1.0\r\n'+
   'Content-Type: text/plain; charset=UTF-8\r\n'+
   'Content-Transfer-Encoding: base64\r\n\r\n'+
   content+'\r\n';
 return base64(encoder.encode(mime)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
