import {manualShopInventory,manualShopAddresses} from '../../supabase/functions/cos-operations-pages/fleetShopProjection';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './fieldMap.css';
import './tvBoardExtensions.css';
import './fleetCompactSheet.css';
import {fieldCameraHealth,cameraTime,type Health,type UnitCameraHealth,type FieldHealthUnit} from './fieldCameraHealth';
import {fieldReachability,fieldReachabilityLabels,isCurrentFieldPin,locationTag,type FieldLocation} from './fieldLocations';
import type {RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';
import {addFieldMapBasemap} from './fieldMapBasemap';
import {loadTvFleetFeeds} from './tvFleetFeeds';
import {automaticRefreshDue,CAMERA_AUTO_REFRESH_MS} from './refreshCadence';
import {tvFleetCensus} from './tvFleetCensus';
import {cameraTimestamp} from './cameraEvidence';
import {type ReticleState} from './fieldMapMarkers';
import {fleetUnitPinMarkup,fleetAddressPinMarkup} from './fleetStatusPins';
import {compactMapGroups,compactMapStatusCounts,compactGroupMarkup,compactGroupDescription,compactGroupPopup,type CompactMapMember} from './fleetCompactMap';
import {readMhelpAddressMapPins,type MhelpAddressMapResult} from './mhelpAddressMapPins';
import {checkedAddressEstimate,addressEstimateLabel,type AddressEstimate} from './fieldAddressEstimates';
import {tvMapTour,tvOutageRows,tvCameraPageSize} from './tvMapTour';
import type {FleetPages} from './tvBoardData';
type Unit=FieldHealthUnit&FieldLocation&{activeJobNumber?:string};
type Snapshot={units:Unit[];inventory:Unit[];health:Health|null;routers:RouterSnapshot|null;readAt:number|null;estimates:Map<string,AddressEstimate>;fieldSource:Record<string,any>|null;addressMap:MhelpAddressMapResult|null};
type Api={get:(path:string)=>Promise<{data:any}>};
const empty:Snapshot={units:[],inventory:[],health:null,routers:null,readAt:null,estimates:new Map(),fieldSource:null,addressMap:null};
export default function TvFleetView({api,enabled,mode,page,width,height,refreshId,onPages,onDelayed}:{api:Api;enabled:boolean;mode:'camera'|'map'|null;page:number;width:number;height:number;refreshId:number;onPages:(pages:FleetPages)=>void;onDelayed?:(delayed:boolean)=>void}){
  const [data,setData]=useState<Snapshot>(empty),[error,setError]=useState(''),[clock,setClock]=useState(Date.now());
  const generation=useRef(0),running=useRef(false),lastAttempt=useRef(0),alive=useRef(false);
  const refresh=useCallback(async(force=false)=>{
    if(running.current)return;
    running.current=true;lastAttempt.current=Date.now();const request=generation.current;
    try{
      const current=()=>alive.current&&request===generation.current;
      const errors=await loadTvFleetFeeds(api,{
        healthUnavailable:()=>{if(current())setData(previous=>({...previous,health:null}));},
        routersUnavailable:()=>{if(current())setData(previous=>({...previous,routers:null}));},
        field:async field=>{
          const units=field.items as Unit[];
          const points=await Promise.all(units.map(async unit=>({id:unit.id,point:await checkedAddressEstimate(unit)})));
          if(current())setData(previous=>({...previous,units,inventory:(Array.isArray((field as any).inventoryItems)?(field as any).inventoryItems:units) as Unit[],fieldSource:field,addressMap:manualShopAddresses(readMhelpAddressMapPins((field as any).mhelpAddressMap,(field as any).uploadInventory,Date.now()),manualShopInventory((field as any).uploadInventory,(field as any).manualPlacementOverrides)),readAt:Date.now(),estimates:new Map(points.filter(row=>row.point!==null).map(row=>[row.id,row.point!]))}));
        },
        health:health=>{if(current())setData(previous=>({...previous,health}));},
        routers:routers=>{if(current())setData(previous=>({...previous,routers}));}
      },force);
      if(current()){setClock(Date.now());setError(errors.join(' '));}
    }catch(cause){if(alive.current&&request===generation.current)setError(cause instanceof Error?cause.message:'Fleet information is unavailable.');}
    finally{running.current=false;}
  },[api]);
  useEffect(()=>{
    if(!enabled){setData(empty);return;}
    alive.current=true;void refresh();
    const tick=()=>{setClock(Date.now());if(automaticRefreshDue(lastAttempt.current,Date.now(),document.hidden,CAMERA_AUTO_REFRESH_MS))void refresh(true);};
    const timer=window.setInterval(tick,60000);
    const invalid=()=>{generation.current++;setData(empty);setError('Sign in again to load fleet information.');};
    document.addEventListener('visibilitychange',tick);window.addEventListener('cos-private-data-invalidated',invalid);
    return()=>{alive.current=false;generation.current++;window.clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('cos-private-data-invalidated',invalid);};
  },[enabled,refresh]);
  useEffect(()=>{if(enabled&&refreshId>0)void refresh(true);},[refreshId,enabled,refresh]);
  const census=useMemo(()=>tvFleetCensus(data.fieldSource,data.inventory,data.health,data.routers,data.addressMap,clock),[data,clock]);
  const rows=useMemo(()=>(census?.items||[]).map(product=>{
    const matches=product.locationUnitId?data.units.filter(unit=>unit.id===product.locationUnitId):[];
    const matched=matches.length===1?matches[0]:null;
    const unit:Unit=matched?matched:
      {id:'mhelp:'+product.productId,unitNumber:product.unitNumber,modelName:product.category,customer:product.customer,site:product.site,address:product.address};
    const base=fieldCameraHealth(unit,data.inventory,data.health,clock);
    const state:UnitCameraHealth['state']=product.status==='not_applicable'?'support':product.status==='unverified'?'unknown':product.status;
    return {productId:product.productId,unit,health:{...base,state,reason:product.reason},router:fieldReachability(unit,data.routers?.items,clock),point:matched?(isCurrentFieldPin(unit)?{latitude:Number(unit.latitude),longitude:Number(unit.longitude)}:data.estimates.get(unit.id)):undefined,estimate:matched?data.estimates.get(unit.id):undefined};
  }).sort((a,b)=>({offline:0,unknown:1,online:2,support:3}[a.health.state]-{offline:0,unknown:1,online:2,support:3}[b.health.state])||a.unit.unitNumber.localeCompare(b.unit.unitNumber)),[census,data,clock]);
  const outages=useMemo(()=>tvOutageRows(rows),[rows]);
  // Fleet and TV use the same strict mHelp Product-ID/address proof; never
  // convert a customer address into GPS verification or guess video health.
  const tvPins=useMemo(()=>{
    const addresses=census&&data.addressMap?.totalField===census.field?data.addressMap:null;
    const health=new Map<string,ReticleState>((census?.items||[]).map(product=>[product.productId,product.status==='not_applicable'?'support':product.status==='unverified'?'unknown':product.status]));
    const productUnits=new Map((census?.items||[]).filter(product=>product.locationUnitId).map(product=>[product.productId,product.locationUnitId!]));
    const coveredUnitIds=new Set((addresses?.pins||[]).map(pin=>productUnits.get(pin.productId)).filter(Boolean));
    type TvPin={key:string;name:string;point:[number,number];health:ReticleState;site:string;address:string;locationLabel:string;verifiedGps:boolean;productId?:string};
    const located:TvPin[]=(addresses?.pins||[]).map(pin=>({
      key:'mhelp:'+pin.productId,name:pin.unitNumber,point:pin.point,
      health:pin.lifecycle==='UNFLAGGED'&&!pin.placementHeld?health.get(pin.productId)||'unknown':'unknown',
      site:pin.customer,address:pin.address,locationLabel:'MHelp customer/service address · not GPS',verifiedGps:false,productId:pin.productId
    }));
    const native:TvPin[]=rows.filter(row=>row.point&&!coveredUnitIds.has(row.unit.id)).map(row=>({
      key:'native:'+row.unit.id,name:row.unit.unitNumber,
      point:[row.point!.latitude,row.point!.longitude],
      health:row.health.state==='online'||row.health.state==='offline'||row.health.state==='support'?row.health.state:'unknown',
      site:row.unit.site||row.unit.customer||'',address:row.unit.address||'',
      locationLabel:isCurrentFieldPin(row.unit)?'Verified installation':row.estimate?addressEstimateLabel(row.estimate)+' · not GPS':locationTag(row.unit),
      verifiedGps:isCurrentFieldPin(row.unit)
    }));
    return {pins:[...located,...native],mhelpLocated:located.length,mhelpTotal:addresses?.totalField||0,mhelpMissing:addresses?.unlocated||0,gpsVerified:rows.filter(row=>isCurrentFieldPin(row.unit)).length};
  },[data,rows,census]);
  const areas=useMemo(()=>tvMapTour(tvPins.pins.map(pin=>({unit:{id:pin.key,unitNumber:pin.name},health:{state:pin.health},point:{latitude:pin.point[0],longitude:pin.point[1]}}))),[tvPins]);
  const count=tvCameraPageSize(width,height),parts=Math.max(1,Math.ceil(outages.length/count));
  const shown=outages.slice((page%parts)*count,(page%parts+1)*count),area=areas[page%areas.length];
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
      for(const value of [item.site||'Site not linked',item.address||'Address not recorded','Camera: '+health.toUpperCase(),item.locationLabel]){
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
  const delayed=Boolean(error||!data.readAt||clock-data.readAt>CAMERA_AUTO_REFRESH_MS*2||!census||!data.health||!cameraTimestamp(data.health.refreshedAt,clock).fresh);
  useEffect(()=>{onDelayed?.(delayed);},[delayed,onDelayed]);
  const totals={online:rows.filter(r=>r.health.state==='online').length,offline:rows.filter(r=>r.health.state==='offline').length,unknown:rows.filter(r=>r.health.state==='unknown').length,mapped:tvPins.gpsVerified};
  return <div className='tv-fleet-view' hidden={!mode} aria-label={mode==='map'?'TV Field Map':'TV Camera Health'}>
    <div className='tv-fleet-summary'>{mode==='camera'?<><b className='tv-offline'>{census?outages.length:'Unavailable'} down units</b><b>Red units only · {page%parts+1} / {parts}</b></>:<><b className='tv-online'>{census?totals.online:'Unavailable'} online</b><b className='tv-offline'>{census?totals.offline:'Unavailable'} offline</b><b>{census?totals.unknown:'Unavailable'} unverified</b><b>{census?census.field-census.counts.support:'Unavailable'} camera-capable Field units</b><b>{census?.counts.support??'Unavailable'} support equipment</b><b>{census?.field??'Unavailable'} Field Product IDs</b><b>{tvPins.mhelpLocated} mHelp address pins</b><b>{totals.mapped} GPS-verified</b></>}<small>Saved observations · read every 4 min{data.readAt?' · '+cameraTime(data.health?.refreshedAt,clock):''}</small></div>
    {delayed&&<p className='tv-fleet-warning' role='status'>Fleet updates delayed or unavailable. Saved observations do not prove current live status. {error}</p>}
    {!data.readAt&&<p className='tv-fleet-loading'>{error?'Fleet information is unavailable.':'Loading Camera Health and field locations…'}</p>}
    <div className='tv-fleet-map-wrap field-map-workspace cos-tv-compact-fleet-map' hidden={mode!=='map'} data-area-kind={area.kind}><div ref={mapNode} className='tv-fleet-map' aria-label='Field unit locations'/>{groupDetails&&mode==='map'&&<section className='cos-compact-group-sheet cos-tv-compact-sheet' role='dialog' aria-label='Grouped TV equipment'><button type='button' className='cos-compact-group-close' aria-label='Close grouped equipment' onClick={()=>setGroupDetails(null)}>× Close</button><div ref={groupHost} className='cos-compact-group-sheet-content'/></section>}<div className='tv-map-area' aria-label='Current map area'><strong>{area.label}</strong><span>{area.ids.length} units · <b className='tv-offline'>{area.offline} down</b> · <b className='tv-online'>{area.online} online</b></span></div><div className='tv-map-legend'><span className='tv-online'>● Online</span><span className='tv-offline'>● Offline</span><span>● Unverified</span><span className='tv-solar'>● Solar / support</span><span>Group ring = equipment health · red = confirmed offline</span><span>{tvPins.mhelpLocated} saved mHelp customer-address pins · {tvPins.mhelpMissing} unresolved · {totals.mapped} GPS-verified units</span></div></div>
    {mode==='camera'&&data.readAt&&<div className='tv-fleet-records'>{shown.map(({productId,unit,health,router})=><article key={productId} className='tv-fleet-record tv-state-offline'><div><h3>{unit.unitNumber}</h3><b>OFFLINE</b><span>Product {productId}</span></div><p>{unit.site||unit.customer||'Site not linked'}</p><p>{unit.address||'Address not recorded'}</p><div><span>{fieldReachabilityLabels[router]}</span><span>{locationTag(unit)}</span></div><small>{unit.activeJobNumber||'No linked job'} · {health.basis==='connection'?'IP / port observation':health.basis==='recorder'?'Recorder observation':'Camera / detector observation'} · {cameraTime(health.checkedAt,clock)}</small></article>)}{!outages.length&&<p>{data.health&&census?'No confirmed red outages in the available records.':'Camera Health is unavailable. Waiting for outage records.'}</p>}</div>}
  </div>;
}
