/** Entirely synthetic PDF bytes for local browser parser testing; no real records. */
export function syntheticTicketPdf() {
  const first = [
    [30,50,'Work'],[30,75,'Order'],[30,100,'for'],[25,120,'Fixture Builders'],[25,140,'100 Office Lane'],[25,160,'Example City, TX 77000'],[25,180,'555-010-0100'],
    [420,130,'200 Provider Way'],[420,160,'555-010-0200'],
    [30,240,'Work Order No. 009001'],[180,240,'Issued on Jan 1, 2026'],
    [34,280,'Created'],[89,280,'Jan 1, 2026'],[178,280,'Priority'],[275,280,'Standard'],
    [34,300,'Status'],[89,300,'New'],[34,320,'Type'],[89,320,'*DELIVERY*'],[178,320,'Assign/Appointment'],[300,320,'Fixture Dispatcher'],
    [34,340,'Job Name'],[99,340,'Fixture Site'],[34,360,'Description'],[99,360,'Address: 300 Service Road, Example, TX 77001'],
    [99,375,'Add one device. Confirm placement.'],[99,390,'Monitoring times are: Mon-Fri 6pm-6am'],[99,405,'Site contacts: Fixture Contact 555-010-0300'],[99,420,'Do not add Excluded Person to the call list.'],
    [34,480,'Quantity'],[88,480,'Item Name'],[260,480,'Notes'],
    [81,500,'1 Solar Device-4 Cam 4'],[260,500,'Video System with 4'],[88,515,'Monitored'],[260,515,'Monitored Cameras'],
    [81,535,'1 Protection'],[260,535,'Protection Plan'],[88,550,'Plan'],[35,570,'01hr 00min Setup and Delivery*'],[260,570,'Setup and Delivery'],
  ];
  const second = [[191,100,'Added by: Fixture Dispatcher'],[191,115,'Jan 1, 2026 14:15']];
  const content = rows => rows.map(([x,y,value]) => `BT /F1 10 Tf 1 0 0 1 ${x} ${792-y} Tm (${value.replace(/[\\()]/g,'\\$&')}) Tj ET`).join('\n');
  const stream1=content(first), stream2=content(second);
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf='%PDF-1.4\n', offsets=[0];
  objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf,'ascii');
}
