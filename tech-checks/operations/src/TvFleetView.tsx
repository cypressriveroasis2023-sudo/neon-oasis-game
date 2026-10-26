import {manualShopInventory,manualShopAddresses} from '../../supabase/functions/cos-operations-pages/fleetShopProjection';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './fieldMap.css';
import './tvBoardExtensions.css';
import './fleetCompactSheet.css';
import {fieldCameraHealth,cameraTime,type Health,type FieldHealthUnit} from './fieldCameraHealth';
import {fieldReachability,fieldReachabilityLabels,isCurrentFieldPin,locationTag,type FieldLocation} from './fieldLocations';
import type {RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';
import {addFieldMapBasemap} from './fieldMapBasemap';
import {loadTvFleetFeeds} from './tvFleetFeeds';
import {automaticRefreshDue} from './refreshCadence';
import {type ReticleState} from './fieldMapMarkers';
import {fleetUnitPinMarkup,fleetAddressPinMarkup,fleetAddressHealth} from './fleetStatusPins';
import {compactMapGroups,compactMapStatusCounts,compactGroupMarkup,compactGroupDescription,compactGroupPopup,type CompactMapMember} from './fleetCompactMap';
import {readMhelpAddressMapPins,type MhelpAddressMapResult} from './mhelpAddressMapPins';
import {tvFieldCensus,tvCensusOutages} from './tvFieldCensus';
import {checkedAddressEstimate,addressEstimateLabel,type AddressEstimate} from './fieldAddressEstimates';
import {tvMapTour,tvCameraPageSize} from './tvMapTour';
import type {FleetPages} from './tvBoardData';
type Unit=FieldHealthUnit&FieldLocation&{activeJobNumber?:string};
type Snapshot={units:Unit[];inventory:Unit[];health:Health|null;routers:RouterSnapshot|null;readAt:number|null;estimates:Map<string,AddressEstimate>;fieldSource:Record<string,any>|null;addressMap:MhelpAddressMapResult|null};
type Api={get:(path:string)=>Promise<{data:any}>};
const INITIAL_READ_RETRY_MS=30000;
const transientReadStatus=(status:number|null)=>status!==null&&[502,503,504,546].includes(status);
const empty:Snapshot={units:[],inventory:[],health:null,routers:null,readAt:null,estimates:new Map(),fieldSource:null,addressMap:null};
export default function TvFleetView({api,enabled,mode,page,width,height,refreshId,onPages}:{api:Api;enabled:boolean;mode:'camera'|'map'|null;page:number;width:number;height:number;refreshId:number;onPages:(pages:FleetPages)=>void}){
  const [data,setData]=useState<Snapshot>(empty),[error,setError]=useState(''),[clock,setClock]=useState(Date.now());
  const generation=useRef(0),running=useRef(false),lastAttempt=useRef(0),alive=useRef(false);
  const retryAt=useRef(0),retryTimer=useRef<number|null>(null),retryUsed=useRef(false),sessionBlocked=useRef(false),retryRead=useRef(()=>{});
  const cancelRetry=()=>{if(retryTimer.current!==null)window.clearTimeout(retryTimer.current);retryTimer.current=null;};
  const refresh=useCallback(async(force=false)=>{
    if(running.current||!alive.current||sessionBlocked.current)return;
    if(force){cancelRetry();retryAt.current=0;}
    const initialAttempt=lastAttempt.current===0;
    running.current=true;lastAttempt.current=Date.now();const request=generation.current;
    try{
      const current=()=>alive.current&&request===generation.current;
      // Stage each response until this read settles. A new placement response
      // must never be displayed with the preceding read's health claims.
      let nextField:Partial<Snapshot>|null=null,nextHealth:Health|null=null,nextRouters:RouterSnapshot|null=null,transientFieldFailure=false,recoveryBlocked=false;
      const errors=await loadTvFleetFeeds(api,{
        readFailure:(source,status)=>{if(source==='fieldMap')transientFieldFailure=transientReadStatus(status);if(!transientReadStatus(status))recoveryBlocked=true;},
        healthUnavailable:()=>{nextHealth=null;},
        routersUnavailable:()=>{nextRouters=null;},
        field:async field=>{
          const units=field.items as Unit[];
          const points=await Promise.all(units.map(async unit=>({id:unit.id,point:await checkedAddressEstimate(unit)})));
          nextField={units,inventory:(Array.isArray((field as any).inventoryItems)?(field as any).inventoryItems:units) as Unit[],fieldSource:field,addressMap:manualShopAddresses(readMhelpAddressMapPins((field as any).mhelpAddressMap,(field as any).uploadInventory,Date.now()),manualShopInventory((field as any).uploadInventory,(field as any).manualPlacementOverrides)),readAt:Date.now(),estimates:new Map(points.filter(row=>row.point!==null).map(row=>[row.id,row.point!]))};
        },
        health:health=>{nextHealth=health;},
        routers:routers=>{nextRouters=routers;}
      },force);
      if(current()){
        setData(previous=>({...previous,...nextField,health:nextField?nextHealth:null,routers:nextRouters}));
        setClock(Date.now());setError(errors.join(' '));
        // One cold-load recovery only, after the complete initial read settles.
        // This reads saved records and never schedules a provider probe.
        if(initialAttempt&&!nextField&&transientFieldFailure&&!recoveryBlocked&&!retryUsed.current&&!sessionBlocked.current){
          retryAt.current=Date.now()+INITIAL_READ_RETRY_MS;
          retryTimer.current=window.setTimeout(()=>retryRead.current(),INITIAL_READ_RETRY_MS);
        }
      }
    }catch(cause){if(alive.current&&request===generation.current){setData(previous=>({...previous,health:null,routers:null}));setError(cause instanceof Error?cause.message:'Fleet information is unavailable.');}}
    finally{if(request===generation.current)running.current=false;}
  },[api]);
  useEffect(()=>{
    if(!enabled){setData(empty);return;}
    alive.current=true;sessionBlocked.current=false;lastAttempt.current=0;retryUsed.current=false;retryAt.current=0;
    retryRead.current=()=>{
      if(!alive.current||sessionBlocked.current||document.hidden||running.current||retryUsed.current||!retryAt.current||Date.now()<retryAt.current)return;
      cancelRetry();retryAt.current=0;retryUsed.current=true;void refresh();
    };
    void refresh();
    const tick=()=>{setClock(Date.now());if(document.hidden){cancelRetry();return;}if(retryAt.current){retryRead.current();if(retryAt.current&&!retryTimer.current)retryTimer.current=window.setTimeout(()=>retryRead.current(),Math.max(0,retryAt.current-Date.now()));}else if(automaticRefreshDue(lastAttempt.current,Date.now(),document.hidden))void refresh(true);};
    const timer=window.setInterval(tick,60000);
    const invalid=()=>{generation.current++;sessionBlocked.current=true;cancelRetry();retryAt.current=0;setData(empty);setError('Sign in again to load fleet information.');};
    document.addEventListener('visibilitychange',tick);window.addEventListener('cos-private-data-invalidated',invalid);
    return()=>{alive.current=false;generation.current++;running.current=false;cancelRetry();retryAt.current=0;window.clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('cos-private-data-invalidated',invalid);};
  },[enabled,refresh]);
  useEffect(()=>{if(enabled&&refreshId>0)void refresh(true);},[refreshId,enabled,refresh]);
  const rows=useMemo(()=>data.units.map(unit=>({unit,health:fieldCameraHealth(unit,data.inventory,data.health,clock),router:fieldReachability(unit,data.routers?.items,clock),point:isCurrentFieldPin(unit)?{latitude:Number(unit.latitude),longitude:Number(unit.longitude)}:data.estimates.get(unit.id),estimate:data.estimates.get(unit.id)})).sort((a,b)=>({offline:0,unknown:1,online:2,support:3}[a.health.state]-{offline:0,unknown:1,online:2,support:3}[b.health.state])||a.unit.unitNumber.localeCompare(b.unit.unitNumber)),[data,clock]);
  const census=useMemo(()=>tvFieldCensus(data.fieldSource,data.inventory,data.health,data.routers,data.addressMap,clock),[data,clock]);
  const outages=useMemo(()=>tvCensusOutages(census.board,rows),[census,rows]);
  // Fleet and TV use the same strict mHelp Product-ID/address proof; never
  // convert a customer address into GPS verification or guess video health.
  const tvPins=useMemo(()=>{
    const addresses=data.addressMap;
    const {rows:dashboardRows,products}=census;
    const health=products?fleetAddressHealth(products.items,dashboardRows,'camera'):new Map<string,ReticleState>();
    const productUnits=new Map((products?.items||[]).filter(product=>product.unitId).map(product=>[product.productId,product.unitId!]));
    const coveredUnitIds=new Set((addresses?.pins||[]).map(pin=>productUnits.get(pin.productId)).filter(Boolean));
    type TvPin={key:string;name:string;point:[number,number];health:ReticleState;site:string;address:string;locationLabel:string;verifiedGps:boolean;productId?:string};
    const located:TvPin[]=(addresses?.pins||[]).map(pin=>({
      key:'mhelp:'+pin.productId,name:pin.unitNumber,point:pin.point,
      health:pin.lifecycle==='UNFLAGGED'&&!pin.placementHeld?health.get(pin.productId)||'unknown':'unknown',
      site:pin.customer,address:pin.address,locationLabel:'MHelp customer/service address · not GPS',verifiedGps:false,productId:pin.productId
    }));
    const native:TvPin[]=rows.filter(row=>row.point&&!coveredUnitIds.has(row.unit.id)&&(!census.board||census.board.items.some(product=>product.linked?.unitId===row.unit.id))).map(row=>({
      key:'native:'+row.unit.id,name:row.unit.unitNumber,
      point:[row.point!.latitude,row.point!.longitude],
      health:row.health.state==='online'||row.health.state==='offline'||row.health.state==='support'?row.health.state:'unknown',
      site:row.unit.site||row.unit.customer||'',address:row.unit.address||'',
      locationLabel:isCurrentFieldPin(row.unit)?'Verified installation':row.estimate?addressEstimateLabel(row.estimate)+' · not GPS':locationTag(row.unit),
      verifiedGps:isCurrentFieldPin(row.unit)
    }));
    return {pins:[...located,...native],mhelpLocated:located.length,mhelpTotal:addresses?.totalField||0,mhelpMissing:addresses?.unlocated||0,gpsVerified:rows.filter(row=>isCurrentFieldPin(row.unit)).length};
  },[data,rows,clock,census]);
  const areas=useMemo(()=>tvMapTour(tvPins.pins.map(pin=>({unit:{id:pin.key,unitNumber:pin.name},health:{state:pin.health},point:{latitude:pin.point[0],longitude:pin.point[1]}}))),[tvPins]);
  const alreadyShown=new Set(outages.map(row=>row.productId).filter(Boolean));
  const sourceOnlyOutages=(census.board?.items||[]).filter(product=>product.status==='offline'
    &&product.linked?.evidence?.association==='exact_product_id_tracker_endpoint'
    &&product.linked?.evidence?.basis==='connection'&&!alreadyShown.has(product.productId));
  const outageCards=[...outages.map(row=>({kind:'native' as const,row})),
    ...sourceOnlyOutages.map(product=>({kind:'source' as const,product}))];
  const count=tvCameraPageSize(width,height),parts=Math.max(1,Math.ceil(outageCards.length/count));
  const shown=outageCards.slice((page%parts)*count,(page%parts+1)*count),area=areas[page%areas.length];
  useEffect(()=>onPages({camera:parts,map:areas.map(area=>area.label)}),[parts,areas,onPages]);
  const mapNode=useRef<HTMLDivElement|null>(null),mapRef=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null);
  const [mapRevision,setMapRevision]=useState(0);
  const [groupDetails,setGroupDetails]=useState<{members:CompactMapMember[];zoom?:()=>void}|null>(null);
  const groupHost=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    const host=groupHost.current;
    if(!host||!groupDetails)return;
    host.replaceChildren(compactGroupPopup(groupDetails.members,groupDetails.zoom));
    return()=>{host.replaceChildren();};
  },[groupDetails]);
  useEffect(()=>{setGroupDetails(null);},[mode,page,enabled,data.readAt]);
  useEffect(()=>{
    if(!groupDetails)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setGroupDetails(null);};
    window.addEventListener('keydown',escape);
    return()=>window.removeEventListener('keydown',escape);
  },[groupDetails]);
  useEffect(()=>{
    if(!enabled||!mapNode.current)return;
    const map=L.map(mapNode.current,{zoomControl:false,attributionControl:true}).setView([31,-99],6);mapRef.current=map;
    addFieldMapBasemap(map);
    layer.current=L.layerGroup().addTo(map);
    const update=()=>setMapRevision(value=>value+1);map.on('zoomend moveend',update);
    return()=>{map.off('zoomend moveend',update);map.remove();mapRef.current=null;layer.current=null;};
  },[enabled]);
  useEffect(()=>{
    const map=mapRef.current,group=layer.current;if(!map||!group)return;
    group.clearLayers();
    const entries=tvPins.pins.map(pin=>({item:pin,...map.latLngToContainerPoint(pin.point)}));
    for(const members of compactMapGroups(entries)){
      if(members.length>1){
        const counts=compactMapStatusCounts(members.map(row=>({health:row.item.health})));
        const point=L.point(members.reduce((n,row)=>n+row.x,0)/members.length,members.reduce((n,row)=>n+row.y,0)/members.length);
        const title=members.length+' field equipment · '+compactGroupDescription(counts);
        const marker=L.marker(map.containerPointToLatLng(point),{
          title,alt:title,zIndexOffset:counts.offline?300:100,
          icon:L.divIcon({className:'cos-compact-group-marker',html:compactGroupMarkup(counts),iconSize:[52,52],iconAnchor:[26,26]})
        });
        marker.on('add',()=>{
          const element=marker.getElement();element?.setAttribute('data-group-count',String(members.length));
          element?.setAttribute('data-offline-count',String(counts.offline));
          element?.setAttribute('data-group-member-ids',JSON.stringify(members.map(row=>row.item.key)));
          element?.setAttribute('aria-label',title);
        });
        const coords=new Set(members.map(row=>row.item.point.join(',')));
        const zoom=coords.size>1&&map.getZoom()<17?()=>{
          map.closePopup();
          map.fitBounds(L.latLngBounds(members.map(row=>row.item.point)),{padding:[64,64],maxZoom:16,animate:false});
        }:undefined;
        const popupMembers:CompactMapMember[]=members.map(({item})=>({
          key:item.key,label:item.name+(item.productId?' · Product '+item.productId:''),health:item.health,
          site:item.site,address:item.address,locationLabel:item.locationLabel,productId:item.productId
        }));
        marker.on('click',()=>setGroupDetails({
          members:popupMembers,zoom:zoom?()=>{
            setGroupDetails(null);
            zoom();
          }:undefined
        }));
        group.addLayer(marker);
        continue;
      }
      const {item}=members[0],health=item.health;
      const html=item.productId?fleetAddressPinMarkup(item.name,health):fleetUnitPinMarkup(item.name,health,item.verifiedGps?'current':'estimate');
      const marker=L.marker(item.point,{title:item.name+' · '+health,alt:item.name+' · '+health,
        icon:L.divIcon({className:'cos-field-pin-wrap cos-tv-fleet-unit-marker',html,iconSize:[44,56],iconAnchor:[22,34]})});
      marker.on('add',()=>{
        const element=marker.getElement();element?.setAttribute('data-map-member-id',item.key);
        if(item.productId)element?.setAttribute('data-mhelp-product-id',item.productId);
      });
      const popup=document.createElement('div');popup.className='cos-compact-tv-pin-popup';
      const title=document.createElement('strong');title.textContent=item.name;popup.append(title);
      for(const value of [item.site||'Site not linked',item.address||'Address not recorded','Camera / connection: '+health.toUpperCase(),item.locationLabel]){
        const p=document.createElement('p');p.textContent=value;popup.append(p);
      }
      marker.bindPopup(popup);group.addLayer(marker);
    }
  },[tvPins,mapRevision,enabled]);
  useEffect(()=>{
    if(mode!=='map')return;
    const frame=requestAnimationFrame(()=>{
      const map=mapRef.current;if(!map)return;map.invalidateSize();
      const points=area.points.map(point=>[point.latitude,point.longitude] as L.LatLngTuple);
      if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[48,48],maxZoom:13,animate:false});
      if(mapNode.current)mapNode.current.dataset.zoom=String(map.getZoom());
    });
    return()=>cancelAnimationFrame(frame);
  },[mode,height,width,area]);
  const locationsAvailable=Boolean(data.readAt);
  const healthAvailable=Boolean(data.health)&&(!census.board||census.board.healthVerified);
  const totals={online:census.board?.counts.online??rows.filter(r=>r.health.state==='online').length,offline:census.board?.counts.offline??rows.filter(r=>r.health.state==='offline').length,unknown:census.board?.counts.unverified??rows.filter(r=>r.health.state==='unknown').length,mapped:tvPins.gpsVerified};
  return <div className='tv-fleet-view' hidden={!mode} aria-label={mode==='map'?'TV Field Map':'TV Camera Health'}>
    <div className='tv-fleet-summary'>{mode==='camera'?<><b className='tv-offline'>{healthAvailable?census.board?census.board.counts.offline+' down units':outageCards.length+' down units':'Outage count unavailable'}</b><b>Red units only · {page%parts+1} / {parts}</b></>:<><b className='tv-online'>{healthAvailable?totals.online:'—'} online</b><b className='tv-offline'>{healthAvailable?totals.offline:'—'} offline</b><b>{locationsAvailable?totals.unknown:'—'} unverified</b>{census.board?<><b>{census.board.field} Field equipment</b><b>{census.board.field-census.board.counts.support} camera-capable equipment</b><b>{census.board.counts.support} support · no cameras</b></>:<b>{locationsAvailable?rows.length+' COS diagnostic units · census unavailable':'Field equipment unavailable'}</b>}<b>{locationsAvailable?tvPins.mhelpLocated:'—'} mHelp address pins</b><b>{locationsAvailable?totals.mapped:'—'} GPS-verified</b></>}<small>Saved camera / placement read every 15 min{data.readAt?' · '+cameraTime(data.health?.refreshedAt,clock):''}</small></div>
    {error&&<p className='tv-fleet-warning' role='status'>Fleet updates delayed. {error}</p>}
    {!data.readAt&&<p className='tv-fleet-loading'>{error?'Fleet information is unavailable.':'Loading Camera Health and field locations…'}</p>}
    <div className='tv-fleet-map-wrap field-map-workspace cos-tv-compact-fleet-map' hidden={mode!=='map'} data-area-kind={area.kind}><div ref={mapNode} className='tv-fleet-map' aria-label='Field unit locations'/>{groupDetails&&mode==='map'&&<section className='cos-compact-group-sheet cos-tv-compact-sheet' role='dialog' aria-label='Grouped TV equipment'><button type='button' className='cos-compact-group-close' aria-label='Close grouped equipment' onClick={()=>setGroupDetails(null)}>× Close</button><div ref={groupHost} className='cos-compact-group-sheet-content'/></section>}<div className='tv-map-area' aria-label='Current map area'><strong>{area.label}</strong><span>{locationsAvailable?area.ids.length:'—'} units · <b className='tv-offline'>{healthAvailable?area.offline:'—'} down</b> · <b className='tv-online'>{healthAvailable?area.online:'—'} online</b></span></div><div className='tv-map-legend'><span className='tv-online'>● Online</span><span className='tv-offline'>● Offline</span><span>● Unverified</span><span className='tv-solar'>● Solar / support</span><span>Group ring = equipment health · red = confirmed offline</span><span>{locationsAvailable?tvPins.mhelpLocated:'—'} saved mHelp customer-address pins · {locationsAvailable?tvPins.mhelpMissing:'—'} unresolved · {locationsAvailable?totals.mapped:'—'} GPS-verified units</span></div></div>
    {mode==='camera'&&data.readAt&&<div className='tv-fleet-records'>{shown.map(entry=>entry.kind==='native'?(
      <article key={entry.row.productId||entry.row.unit.id} data-product-id={entry.row.productId} className='tv-fleet-record tv-state-offline'><div><h3>{entry.row.unit.unitNumber}</h3>{entry.row.productId&&<small>Product {entry.row.productId}</small>}<b>OFFLINE</b></div><p>{entry.row.unit.site||entry.row.unit.customer||'Site not linked'}</p><p>{entry.row.unit.address||'Address not recorded'}</p><div><span>{fieldReachabilityLabels[entry.row.router]}</span><span>{locationTag(entry.row.unit)}</span></div><small>{entry.row.unit.activeJobNumber||'No linked job'} · {entry.row.health.basis==='connection'?'IP / port observation':entry.row.health.basis==='recorder'?'Recorder observation':'Camera / detector observation'} · {cameraTime(entry.row.health.checkedAt,clock)}</small></article>
    ):(
      <article key={entry.product.productId} data-product-id={entry.product.productId} className='tv-fleet-record tv-state-offline'><div><h3>{entry.product.unitNumber}</h3><small>Product {entry.product.productId}</small><b>OFFLINE</b></div><p>{entry.product.site||entry.product.customer||'Site not linked'}</p><p>{entry.product.address||'Customer address not recorded'}</p><div><span>Router status unknown</span><span>mHelp customer address · location not GPS verified</span></div><small>Exact Product-ID saved TCP/service-port nonresponse · {cameraTime(entry.product.linked?.evidence?.observedAt,clock)} · video not verified</small></article>
    ))}{!outageCards.length&&<p>{data.health?'No confirmed red outages in the available records.':'Camera Health is unavailable. Waiting for outage records.'}</p>}</div>}
  </div>;
}
