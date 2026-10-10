import {describeMhelpPrivateSample,unavailableMhelpPrivateSample,validateMhelpPrivateSampleRequest} from '../../../supabase/functions/cos-operations-pages/mhelpTicketPrivateSample.ts';
export const privateSampleNow='2026-04-15T17:00:00.000Z';
export const privateSampleRequest={ticketNumber:'61042',appointmentDay:'2026-04-16'};
export const syntheticPrivateAppointment=(overrides={})=>({id:99001,ticketId:88001,portalId:73001,userId:'operator.synthetic@example.test',startUtc:'2026-04-16T13:00:00Z',endUtc:'2026-04-16T16:00:00Z',subject:'Earlier note: work on another day',description:'Recorded appointment work\nKeep this line exactly.',...overrides});
export const syntheticPrivateItems=()=>[
 {name:'Synthetic equipment item',description:'Synthetic equipment description',notes:'First line\n  Keep indentation & <tag> literally.\r\nLast line',quantity:4,durationSeconds:0,rate:'excluded-rate',amount:'excluded-amount',taxCodeId:'excluded-tax'},
 {name:'Synthetic monitoring service',description:'Service item',notes:'Review service scope',quantity:'12.00',durationSeconds:0,cost:'excluded-cost'},
 {name:'Synthetic protection plan',description:'Plan item',notes:'Review plan scope',quantity:4,durationSeconds:0},
 {name:'Synthetic setup time',description:'Time item',notes:'Set up and deliver\nAdded by: Synthetic Operator',quantity:0,durationSeconds:7200},
];
export function privateTicketSampleFixture({request=privateSampleRequest,now=privateSampleNow,reason,selection={pageLimit:500,sampledTickets:0,reportedTotal:0,matchingTickets:0},items=syntheticPrivateItems(),appointments={totalRows:3,results:[syntheticPrivateAppointment(),syntheticPrivateAppointment({id:99002,ticketId:88002,subject:'unmatched-private-content'}),syntheticPrivateAppointment({id:99003,TicketId:88002,subject:'conflicting-private-content'})]}}={}){
 const input=validateMhelpPrivateSampleRequest(request,new Date(now));
 return reason?unavailableMhelpPrivateSample(input,reason,selection,now):describeMhelpPrivateSample(input,{portalId:'73001',ticketId:'88001',ticketNumber:request.ticketNumber},{items,customer:{email:'excluded-contact'},invoice:{amount:'excluded-total'}},appointments,now);
}
