'use client';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { pickupCode, pickupName, type LivePosition, type MapPoint } from '@/lib/dispatch-model';
import { CARTO_ATTRIBUTION, cartoDarkMatterUrl } from '@/lib/carto-basemap';
import styles from './dispatch.module.css';
const tileUrl=cartoDarkMatterUrl(process.env.NEXT_PUBLIC_CARTO_API_KEY);
export default function DispatchMap({points,line,live,focus,centerKey,onSelect,fitAll=false,onView,onAssign,canAssign=false,onPick}: {
 points:MapPoint[];line:([number,number]|null)[];live:LivePosition[];focus:string;centerKey:string;onSelect:(key:string)=>void;
 fitAll?:boolean;onView?:(key:string)=>void;onAssign?:(key:string)=>void;canAssign?:boolean;onPick?:(lat:number,lng:number)=>void;
}){
 const element=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),lastCenter=useRef('');
 const popupKey=useRef(''),rebuilding=useRef(false);
 const [tileError,setTileError]=useState(false);
 useEffect(()=>{
  if(!element.current)return;
  const instance=L.map(element.current,{zoomControl:false}).setView([-33.4489,-70.6693],10);map.current=instance;
  L.control.zoom({position:'topright'}).addTo(instance);instance.attributionControl.addAttribution(CARTO_ATTRIBUTION);
  instance.attributionControl.addAttribution('<a href="https://opencagedata.com/credits">Geocoding by OpenCage</a>');
  if(tileUrl){const tiles=L.tileLayer(tileUrl,{maxNativeZoom:18,maxZoom:20});tiles.on('loading',()=>setTileError(false));tiles.on('tileerror',()=>setTileError(true));tiles.addTo(instance);}
  instance.on('popupclose',()=>{if(!rebuilding.current)popupKey.current='';});
  const observer=new ResizeObserver(()=>instance.invalidateSize());observer.observe(element.current);
  return()=>{observer.disconnect();instance.remove();map.current=null;lastCenter.current='';};
 },[]);
 useEffect(()=>{
  const instance=map.current;if(!instance||!onPick)return;
  const select=(event:L.LeafletMouseEvent)=>onPick(event.latlng.lat,event.latlng.lng);
  instance.on('click',select);return()=>{instance.off('click',select);};
 },[onPick]);
 useEffect(()=>{
  const instance=map.current;if(!instance)return;
  rebuilding.current=true;
  const layer=L.layerGroup().addTo(instance);
  const cluster=L.markerClusterGroup({animate:false,showCoverageOnHover:false,maxClusterRadius:45,disableClusteringAtZoom:17,spiderfyOnMaxZoom:true});
  layer.addLayer(cluster);
  const markers=new Map<string,L.Marker>();
  const marker=(lat:number,lon:number,text:string,label:string,color:string,selected:boolean,callback:()=>void,stale=false,group:L.LayerGroup=layer)=>{
   const badge=document.createElement('div');badge.textContent=text;badge.className=styles.marker;badge.style.backgroundColor=color;badge.style.opacity=stale?'.55':'1';
   if(selected){badge.style.outline='3px solid white';badge.style.transform='scale(1.2)';}
   const pin=L.marker([lat,lon],{icon:L.divIcon({html:badge,className:styles.markerRoot,iconSize:[32,32],iconAnchor:[16,16]}),title:label,keyboard:true,draggable:!!onPick}).addTo(group);
   const tip=document.createElement('span');tip.textContent=label;pin.bindTooltip(tip).on('click',callback);
   if(onPick)pin.on('dragend',()=>{const point=pin.getLatLng();onPick(point.lat,point.lng);});
   return pin;
  };
  let segment:[number,number][]=[];const flush=()=>{if(segment.length>1)L.polyline(segment,{color:'#34d399',weight:3,opacity:.85,dashArray:'8 6'}).addTo(layer);segment=[];};
  for(const point of line){if(point)segment.push(point);else flush();}flush();
  for(const point of points){
   const pin=marker(point.latitud,point.longitud,point.order==null?'•':String(point.order),`${point.label} · ${point.detail}`,point.kind==='assigned'?'#047857':'#b45309',point.key===focus,()=>onSelect(point.key),false,point.kind==='unassigned'&&!onPick?cluster:layer);
   markers.set(point.key,pin);
   if(point.pickup){
    const item=point.pickup,body=document.createElement('div');body.className=styles.popup;
    const title=document.createElement('strong');title.textContent=pickupCode(item);body.append(title);
    for(const value of [pickupName(item),item.direccion||'Sin dirección',item.comuna||'Sin comuna',item.material||'Sin material',item.fecha_retiro||item.fecha_solicitud||'Sin fecha',item.estado||'Sin estado']){
     const row=document.createElement('p');row.textContent=value;body.append(row);
    }
    if(onView){const button=document.createElement('button');button.textContent='Ver solicitud';button.type='button';button.onclick=()=>onView(point.key);body.append(button);}
    if(onAssign&&point.kind==='unassigned'){const button=document.createElement('button');button.textContent='Asignar a ruta';button.type='button';button.disabled=!canAssign;button.onclick=()=>onAssign(point.key);body.append(button);}
    pin.bindPopup(body,{autoPan:false,maxWidth:300});
    pin.on('popupopen',()=>{popupKey.current=point.key;});
   }
  }
  for(const position of live)markers.set(position.key,marker(position.latitud,position.longitud,position.source==='phone'?'D':'T',`${position.label} · ${new Date(position.timestamp).toLocaleString('es-CL')} · ${position.online?'En línea':'Última posición conocida'}`,position.source==='phone'?'#2563eb':'#9333ea',position.key===focus,()=>onSelect(position.key),!position.online));
  const focusPoint=points.find(point=>point.key===focus)||live.find(point=>point.key===focus),key=`${centerKey}:${focus}`;
  const centerChanged=key!==lastCenter.current;
  if(key!==lastCenter.current){
   lastCenter.current=key;
   if(focusPoint){instance.setView([focusPoint.latitud,focusPoint.longitud],Math.max(instance.getZoom(),16));popupKey.current=focus;}
   else{const assigned=points.filter(point=>point.kind==='assigned');const visible=fitAll?points.filter(point=>point.kind==='unassigned'):[...(assigned.length?assigned:points),...live];if(visible.length)instance.fitBounds(L.latLngBounds(visible.map(point=>[point.latitud,point.longitud])),{padding:[50,50],maxZoom:15});}
  }
  const selected=markers.get(popupKey.current);
  if(selected?.getPopup()){
   if(cluster.hasLayer(selected)&&centerChanged)cluster.zoomToShowLayer(selected,()=>selected.openPopup());else if(instance.hasLayer(selected))selected.openPopup();
  }
  rebuilding.current=false;
  return()=>{rebuilding.current=true;layer.remove();rebuilding.current=false;};
 },[points,line,live,focus,centerKey,onSelect,fitAll,onView,onAssign,canAssign,onPick]);
 return <div className={styles.mapContainer}><div className={styles.map} ref={element} aria-label={onPick?'Seleccionar ubicación exacta':'Mapa interactivo de rutas y solicitudes'}/>
  <div className={styles.mapLegend}><span><i style={{background:'#10b981'}}/>Paradas</span><span><i style={{background:'#f59e0b'}}/>Sin asignar</span><span><i style={{background:'#3b82f6'}}/>Driver</span><span><i style={{background:'#a855f7'}}/>ESP32</span></div>
  {!tileUrl&&<p className={styles.mapWarning} role="status">Mapa base pendiente de configuración. Solicita al administrador configurar la clave de CARTO. Las rutas y posiciones siguen disponibles.</p>}
  {tileError&&<p className={styles.mapWarning} role="status">No se pudo cargar el fondo cartográfico. Revisa la clave de CARTO y la conexión; las rutas y posiciones siguen disponibles.</p>}
  <p className={styles.mapNote}>{onPick?'Haz clic o arrastra el marcador y confirma la ubicación antes de guardar.':'Línea de visita entre coordenadas · no representa navegación por calles'}</p>
 </div>;
}
