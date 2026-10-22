// Trusted server destinations. These are existing folders, not creation requests.
export const TECHNICIANS_ROOT=Object.freeze({id:'1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH',name:'Technicians'});
export const TECHNICIAN_FOLDERS=Object.freeze([
 {id:'1Im1trPgcC4NIw9eTfaobWTRSpNPlfgvt',name:'Teddy Hopper'},
 {id:'1xa5s67_JsQWG5A9XG-6ZHlb1oyVEK4Lm',name:'Victor Garcia'},
 {id:'1gzBr-u6Xd6i19I7PE0rnB_47Ipi8IWWz',name:'Josh Mireles'},
 {id:'1NGanUoAXTVAZDPuHGE-pz6Xt6kkuanU6',name:'Abel Cervantes'},
]);
const FOLDER='application/vnd.google-apps.folder';
const ID=/^[A-Za-z0-9_-]{3,200}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS='id,name,mimeType,parents,appProperties,trashed';
type Row=Record<string,any>;
type Source='transfer'|'daily';
type Slot={id:string;parent_id:string;name:string;adopted:boolean};
type Connection={request:typeof fetch;auth:Record<string,string>};
type Resolver=Connection&{source:Source;report:Row;manifest:Row;checkpoint:()=>Promise<unknown>;call:(name:string,args:Row)=>Promise<any>};
export class ArchiveDestinationBlocked extends Error {}

function drive({request,auth}:Connection){
 const send=(url:string,options:RequestInit={})=>request(url,{...options,headers:{...auth,...options.headers},signal:AbortSignal.timeout(30000)});
 const json=async(response:Response)=>{if(!response.ok)throw new Error('Archive destination request failed.');return response.json();};
 const metadata=async(id:string)=>{
  if(!ID.test(id))throw new ArchiveDestinationBlocked('Saved archive folder identity is invalid.');
  const response=await send('https://www.googleapis.com/drive/v3/files/'+id+'?fields='+FIELDS+'&supportsAllDrives=true');
  return response.status===404?null:json(response);
 };
 const children=async(parent:string,name:string)=>{
  const quote=(value:string)=>value.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const found:Row[]=[];let pageToken:string|undefined;
  for(let page=0;page<10;page++){
   const query=new URLSearchParams({q:"'"+quote(parent)+"' in parents and trashed = false and mimeType = '"+FOLDER+"' and name = '"+quote(name)+"'",fields:'nextPageToken,files('+FIELDS+')',pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
   if(pageToken)query.set('pageToken',pageToken);
   const result=await json(await send('https://www.googleapis.com/drive/v3/files?'+query));
   if(!Array.isArray(result.files))throw new Error('Archive destination listing is incomplete.');
   found.push(...result.files);
   if(found.length>1)throw new ArchiveDestinationBlocked('Duplicate date or category folders require Owner review.');
   if(!result.nextPageToken)return found;
   pageToken=result.nextPageToken;
  }
  throw new ArchiveDestinationBlocked('Archive folder uniqueness could not be verified.');
 };
 const generate=async()=>{
  const result=await json(await send('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files'));
  if(!ID.test(result.ids?.[0]||''))throw new Error('Archive folder ID could not be reserved.');return result.ids[0] as string;
 };
 const create=async(slot:Slot,properties:Row)=>{
  const response=await send('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:slot.id,name:slot.name,mimeType:FOLDER,parents:[slot.parent_id],appProperties:properties})});
  if(!response.ok&&response.status!==409)throw new Error('Archive destination creation interrupted.');
 };
 return {metadata,children,generate,create};
}
function folderMatches(file:Row|null,id:string,name?:string,parent?:string){
 return Boolean(file&&file.id===id&&file.mimeType===FOLDER&&file.trashed===false&&(!name||file.name===name)&&(!parent||(Array.isArray(file.parents)&&file.parents.length===1&&file.parents[0]===parent)));
}

// Read-only deployment probe: no queue claims, reservations, files or sharing.
export async function verifyTechnicianArchiveConnection(connection:Connection){
 const api=drive(connection),root=await api.metadata(TECHNICIANS_ROOT.id);
 if(!folderMatches(root,TECHNICIANS_ROOT.id,TECHNICIANS_ROOT.name))throw new ArchiveDestinationBlocked('The verified Technicians archive root is unavailable.');
 for(const technician of TECHNICIAN_FOLDERS){
  if(!folderMatches(await api.metadata(technician.id),technician.id,technician.name,TECHNICIANS_ROOT.id))throw new ArchiveDestinationBlocked('A verified technician archive folder is unavailable.');
 }
 return {root_id:TECHNICIANS_ROOT.id,technician_folders_verified:TECHNICIAN_FOLDERS.length};
}

// Only new packages resolve a destination. Existing package IDs are read back
// directly and may already have been moved by the Owner into named folders.
export async function resolveTechnicianArchiveDestination(options:Resolver):Promise<string>{
 const {source,report,manifest,checkpoint,call}=options,api=drive(options);
 const marker=source==='transfer'?'techcheck_transfer_event_id':'techcheck_report_id';
 if(manifest.folder!==undefined){
  const entry=manifest.folder;
  if(!entry||typeof entry!=='object'||!ID.test(entry.id||'')||(entry.done!==undefined&&typeof entry.done!=='boolean'))throw new ArchiveDestinationBlocked('Saved package folder identity requires review.');
  const existing=await api.metadata(entry.id);
  if(existing){
   if(!folderMatches(existing,entry.id)||existing.appProperties?.[marker]!==report.id||existing.appProperties?.techcheck_part!=='folder'||!Array.isArray(existing.parents)||existing.parents.length!==1||!ID.test(existing.parents[0]))throw new ArchiveDestinationBlocked('Saved package folder could not be verified.');
   // Keep its original ID and current parent. A routing migration never moves it.
   entry.done=true;entry.readback_parent_id=existing.parents[0];await checkpoint();return existing.parents[0];
  }
  if(entry.done===true)throw new ArchiveDestinationBlocked('A completed package folder is missing. Do not recreate the original.');
 }
 const args={p_source:source,p_id:report.id,p_lease:report.lease_token};
 const context=await call('techcheck_archive_destination_v1',{p_action:'context',...args});
 if(context?.version!==1||context.source!==source||context.source_id!==report.id||!UUID.test(context.actor_id||'')||!/^\d{4}-\d{2}-\d{2}$/.test(context.check_date||''))throw new ArchiveDestinationBlocked('Canonical archive destination could not be verified.');
 if(context.enabled!==true||context.ready!==true)throw new ArchiveDestinationBlocked(context.status==='mapping_required'?'This technician needs an approved archive folder mapping.':'Technician archive routing is awaiting release approval.');
 const category=source==='transfer'?'Equipment Transfers':'Truck Inspections';
 const technician=TECHNICIAN_FOLDERS.find(folder=>folder.id===context.technician_folder?.id&&folder.name===context.technician_folder?.name);
 if(context.category!==category||context.root_folder?.id!==TECHNICIANS_ROOT.id||!technician||report.check_date!==context.check_date)throw new ArchiveDestinationBlocked('Canonical technician, date or category does not match the saved report.');
 const baseRouting={version:1,source,source_id:report.id,actor_id:context.actor_id,check_date:context.check_date,category,root_id:TECHNICIANS_ROOT.id,technician_folder_id:technician.id};
 if(manifest.archive_destination){
  const pinned=manifest.archive_destination;
  if(Object.entries(baseRouting).some(([key,value])=>pinned[key]!==value)||pinned.date_folder_id!==context.date_folder?.id||pinned.category_folder_id!==context.category_folder?.id||pinned.package_parent_id!==context.category_folder?.id)throw new ArchiveDestinationBlocked('Saved package destination changed. Resume its original destination.');
 }else if(manifest.folder?.parent_id)throw new ArchiveDestinationBlocked('The reserved package parent has no verified routing record.');
 if(!folderMatches(await api.metadata(TECHNICIANS_ROOT.id),TECHNICIANS_ROOT.id,TECHNICIANS_ROOT.name)||!folderMatches(await api.metadata(technician.id),technician.id,technician.name,TECHNICIANS_ROOT.id))throw new ArchiveDestinationBlocked('The verified technician archive path is unavailable.');
 const resolve=async(kind:'date'|'category',parent:string,name:string,prior:any):Promise<Slot>=>{
  let slot:Slot=prior,matches:Row[]|undefined;
  if(!slot){
   matches=await api.children(parent,name);const found=matches[0];
   if(found&&!folderMatches(found,found.id,name,parent))throw new ArchiveDestinationBlocked('The existing archive destination could not be verified.');
   const candidate=found?.id||await api.generate();
   slot=await call('techcheck_archive_destination_v1',{p_action:'reserve',...args,p_data:{kind,candidate_id:candidate,parent_id:parent,adopted:Boolean(found)}});
  }
  if(!slot||!ID.test(slot.id||'')||slot.parent_id!==parent||slot.name!==name||typeof slot.adopted!=='boolean')throw new ArchiveDestinationBlocked('Canonical archive folder reservation is invalid.');
  // A later manual same-name folder must not make a reserved-but-uncreated
  // slot produce a duplicate. Canonical IDs still win concurrent reservations.
  matches??=await api.children(parent,name);
  if(matches[0]&&matches[0].id!==slot.id)throw new ArchiveDestinationBlocked('A different date or category folder conflicts with the reserved destination.');
  const properties:Row={techcheck_archive_kind:kind,techcheck_archive_actor_id:context.actor_id,techcheck_archive_date:context.check_date};
  if(kind==='category')properties.techcheck_archive_category=category;
  let saved=await api.metadata(slot.id);
  if(!saved){
   if(slot.adopted)throw new ArchiveDestinationBlocked('An existing date or category folder is missing. Do not replace it.');
   await api.create(slot,properties);saved=await api.metadata(slot.id);
  }
  if(!folderMatches(saved,slot.id,name,parent)||(!slot.adopted&&Object.entries(properties).some(([key,value])=>saved!.appProperties?.[key]!==value)))throw new ArchiveDestinationBlocked('Archive destination readback does not match its reserved identity.');
  return slot;
 };
 const date=await resolve('date',technician.id,context.check_date,context.date_folder);
 const categoryFolder=await resolve('category',date.id,category,context.category_folder);
 const routing={...baseRouting,date_folder_id:date.id,category_folder_id:categoryFolder.id,package_parent_id:categoryFolder.id};
 if(manifest.archive_destination){
  const prior=manifest.archive_destination;
  if(Object.entries(routing).some(([key,value])=>prior[key]!==value))throw new ArchiveDestinationBlocked('Saved package destination changed. Resume its original destination.');
 }
 if(manifest.folder?.parent_id&&manifest.folder.parent_id!==categoryFolder.id)throw new ArchiveDestinationBlocked('The reserved package parent changed.');
 manifest.archive_destination=routing;
 if(manifest.folder)manifest.folder.parent_id=categoryFolder.id;
 // Required before the original worker reserves/creates its package folder.
 await checkpoint();return categoryFolder.id;
}
