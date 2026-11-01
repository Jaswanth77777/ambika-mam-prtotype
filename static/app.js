const role=String(document.body.dataset.role||'STUDENT').trim().toUpperCase(), csrf=document.body.dataset.csrf||'';
let buses=[], routes=[], stops=[], selectedBus=null, overviewMap=null, trackingMap=null, campusMarker=null, markers={overview:{},tracking:{}}, demoMarkers={}, demoAnimation=null, tileLayers={}, refreshTimer=null, modalKind='bus', driverWatch=null, viewHistory=[role==='ADMIN'?'overview':role==='STUDENT'?'student-dashboard':'driver-dashboard'];
const $=id=>document.getElementById(id); const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusClass=s=>s==='LIVE GPS'?'live':s==='STALE'?'stale':s==='DEMO GPS'?'demo':'none';
function toast(msg,type='success'){const box=document.createElement('div');box.className='toast '+(type==='error'?'error':'success');box.textContent=msg;$('toast-stack').appendChild(box);setTimeout(()=>box.remove(),4200)}
function toggleSidebar(){$('sidebar').classList.toggle('open')}
function navigate(view,record=true){const allowedViews=({ADMIN:['overview','tracking','buses','routes','students','alerts','reports','imports','admin-data','admin-students','admin-drivers','admin-buses','admin-routes','admin-stops','admin-trips','admin-attendance','admin-maintenance','admin-permissions','admin-settings'],STUDENT:['student-dashboard','student-profile','student-bus','tracking','student-route','student-arrival','student-notifications','student-attendance','student-emergency','student-support','student-password'],DRIVER:['driver-dashboard','driver-profile','driver-bus','driver-trips','driver-start','driver-end','driver-gps','driver-route','driver-status','driver-attendance','driver-emergency','driver-notifications','driver-issue','driver-password']})[role]||[];if(!allowedViews.includes(view)){toast('This option is not available for your account.','error');return}if(record&&document.querySelector('.view.active')?.id!==`view-${view}`){viewHistory.push(view);if(viewHistory.length>30)viewHistory.shift()}document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));const target=$('view-'+view);if(!target){toast('This section is not available.','error');return}target.classList.add('active');document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));const names={overview:'Overview',tracking:'Live tracking',buses:'Bus fleet',routes:'Routes & stops',students:'Student transport',imports:'Excel import',alerts:'Alerts',reports:'Reports',settings:'Settings','student-dashboard':'Student Dashboard','student-profile':'My Profile','student-bus':'My Bus','student-route':'My Route','student-arrival':'Bus Arrival Information','student-notifications':'Notifications','student-attendance':'Attendance','student-emergency':'Emergency Contact','student-support':'Help & Support','student-password':'Change Password','driver-dashboard':'Driver Dashboard','driver-profile':'My Profile','driver-bus':'My Bus','driver-trips':'My Trips','driver-start':'Start Trip','driver-end':'End Trip','driver-gps':'Live GPS Sharing','driver-route':'Route & Stops','driver-status':'Trip Status','driver-attendance':'Student Attendance','driver-emergency':'Emergency Alert','driver-notifications':'Notifications','driver-issue':'Bus Issue Report','driver-password':'Password & Logout'};$('crumb').textContent=(role==='ADMIN'?'Admin Portal':role==='STUDENT'?'Student Portal':'Driver Portal')+' / '+(names[view]||view);$('sidebar').classList.remove('open');if(view==='tracking'){setTimeout(()=>{initTrackingMap();trackingMap&&trackingMap.invalidateSize();refreshBuses()},120)}if(view==='buses')renderBusTable();if(view==='routes')loadRoutes();if(view==='students')loadStudents();if(view==='alerts')loadAlerts();if(view==='overview')setTimeout(()=>overviewMap&&overviewMap.invalidateSize(),100);if(view.startsWith('student-'))loadStudentPortal();if(view.startsWith('driver-'))loadDriverPortal()}
function goBack(){if(viewHistory.length>1){viewHistory.pop();const previous=viewHistory[viewHistory.length-1];navigate(previous,false)}else navigate(role==='ADMIN'?'overview':role==='STUDENT'?'student-dashboard':'driver-dashboard',false)}
document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>navigate(n.dataset.view)));
document.addEventListener('keydown',e=>{if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();goBack()}});
function initMap(which){const isOverview=which==='overview';const id=isOverview?'overview-map':'tracking-map';if(!$(id))return null;if(!window.L){$('connection-label').textContent='Map library unavailable';return null}const existing=isOverview?overviewMap:trackingMap;if(existing){setTimeout(()=>existing.invalidateSize(),80);return existing}const map=L.map(id,{zoomControl:true,preferCanvas:true}).setView([8.2436,77.6058],11);const standard=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'});const aerial=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,attribution:'Tiles &copy; Esri'});let fallbackAdded=false;standard.on('tileerror',()=>{if(!fallbackAdded&&map.hasLayer(standard)){fallbackAdded=true;map.removeLayer(standard);const fallback=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap &copy; CARTO'});tileLayers.standard=fallback;fallback.addTo(map);$('connection-label').textContent='Using alternate map tiles'}});standard.addTo(map);if(isOverview)overviewMap=map;else{trackingMap=map;tileLayers={standard,aerial};campusMarker=L.marker([8.2436,77.6058],{title:'JOY University campus'}).addTo(map).bindPopup('<b>JOY University</b><br>Campus reference point. Bus positions appear only after GPS is received.');}map.on('tileerror',()=>{$('connection-label').textContent='Map tiles unavailable';});map.whenReady(()=>setTimeout(()=>map.invalidateSize(),80));return map}
function initTrackingMap(){return initMap('tracking')}
function setMapMode(mode){const map=initTrackingMap();if(!map)return;Object.values(tileLayers).forEach(l=>{if(map.hasLayer(l))map.removeLayer(l)});(mode==='satellite'?tileLayers.aerial:tileLayers.standard).addTo(map);$('mode-2d').classList.toggle('active',mode==='2d');$('mode-satellite').classList.toggle('active',mode==='satellite')}
function markerIcon(bus,selected=false,heading=0){const cls=statusClass(bus.tracking_status);return L.divIcon({className:'joy-bus-icon',html:`<div class="bus-map-marker ${cls} ${selected?'selected':''}"><span class="bus-direction" style="transform:rotate(${Number(heading)||0}deg)">🚌</span><b>${esc(bus.bus_no)}</b></div>`,iconSize:[112,38],iconAnchor:[56,19]})}
function gpsBearing(a,b){const rad=x=>x*Math.PI/180,lat1=rad(a.lat),lat2=rad(b.lat),dLon=rad(b.lng-a.lng);const y=Math.sin(dLon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);return(Math.atan2(y,x)*180/Math.PI+360)%360}
function upsertMarkers(mapName,map){
 if(!map)return;
 const holder=markers[mapName];
 const visible=buses.filter(b=>(mapName!=='tracking'||selectedBus===null||(Number(b.id)===Number(selectedBus)&&b.tracking_status==='LIVE GPS'))&&b.lat!==null&&b.lat!==undefined&&b.lng!==null&&b.lng!==undefined&&Number.isFinite(Number(b.lat))&&Number.isFinite(Number(b.lng)));
 visible.forEach(b=>{
  const key=b.id,ll={lat:Number(b.lat),lng:Number(b.lng)};
  if(!holder[key]){
   holder[key]=L.marker([ll.lat,ll.lng],{icon:markerIcon(b,selectedBus===Number(key),Number(b.heading)||0)}).addTo(map);
   holder[key].on('click',()=>selectBus(key,true));
  }else{
   const marker=holder[key],from=marker.getLatLng(),to=L.latLng(ll.lat,ll.lng);
   marker.setIcon(markerIcon(b,selectedBus===Number(key),Number(b.heading)||gpsBearing(from,to)));
   const distance=from.distanceTo(to);
   if(distance>2){
    const token=(marker._joyMoveToken||0)+1;marker._joyMoveToken=token;
    const start=performance.now(),duration=14500;
    const bearing=gpsBearing(from,to);
    function moveFrame(now){
     if(marker._joyMoveToken!==token)return;
     const t=Math.min(1,(now-start)/duration),ease=t*t*(3-2*t);
     marker.setLatLng([from.lat+(to.lat-from.lat)*ease,from.lng+(to.lng-from.lng)*ease]);
     if(t<1)requestAnimationFrame(moveFrame);
    }
    requestAnimationFrame(moveFrame);
   }else marker.setLatLng(to);
  }
  holder[key].bindPopup(`<div class="popup-bus"><b>${esc(b.bus_no)} · ${esc(b.tracking_status)}</b><p>Route: ${esc(b.route_name||'Not assigned')}<br>Speed: ${b.speed==null?'Unavailable':Math.round(b.speed*3.6)+' km/h'}<br>Last update: ${esc(formatAge(b.age_seconds))}<br>Source: ${esc(b.source||'No GPS data')}</p></div>`);
 });
 Object.keys(holder).forEach(k=>{if(!visible.some(b=>String(b.id)===String(k))){map.removeLayer(holder[k]);delete holder[k]}});
}
function formatAge(seconds){if(seconds==null)return 'No location received';if(seconds<60)return `${seconds}s ago`;if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;return `${Math.floor(seconds/3600)}h ago`}
async function getJSON(url){const r=await fetch(url,{credentials:'same-origin',headers:{'Accept':'application/json'}});let data;try{data=await r.json()}catch(_){data=null}if(!r.ok)throw new Error(data?.error||`Request failed (${r.status})`);return data}
async function loadOverview(){try{const data=await getJSON('/api/overview');buses=data.buses;renderMetrics(data.counts);renderMiniFleet();renderImports(data.imports);upsertMarkers('overview',initMap('overview'));$('connection-label').textContent='Portal connected';}catch(e){toast(e.message,'error')}}
function renderMetrics(c){const entries=[['Total fleet',c.buses,'Registered buses','blue','▰'],['Active buses',c.active,'Available for service','green','↗'],['Drivers',c.drivers,'Registered accounts','purple','♙'],['Students',c.students,'Transport assignments','amber','♧'],['Routes',c.routes,'Configured routes','blue','⌁'],['Active trips',c.trips,'Scheduled or running','purple','◷'],['Open alerts',c.alerts,'Require attention','red','!']];$('metrics').innerHTML=entries.map(([label,val,foot,color,icon])=>`<div class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${color}">${icon}</span></div><div class="metric-value">${val??0}</div><div class="metric-foot">${foot}</div></div>`).join('');$('alert-count').textContent=c.alerts||0}
function renderMiniFleet(){$('fleet-mini-list').innerHTML=buses.slice(0,6).map(b=>`<div class="mini-bus-row" onclick="openBusFromDashboard(${b.id})"><div class="bus-avatar">🚌</div><div class="mini-bus-main"><b>${esc(b.bus_no)}</b><span>${esc(b.route_name||'Route not assigned')}</span></div><span class="mini-status ${statusClass(b.tracking_status)}">${esc(b.tracking_status)}</span></div>`).join('')||'<div class="empty-state">No buses found.</div>'}
async function openBusFromDashboard(id){navigate('tracking');await new Promise(resolve=>setTimeout(resolve,180));initTrackingMap();trackingMap?.invalidateSize();await refreshBuses();await selectBus(Number(id),true)}
function renderImports(rows){if(!rows?.length){$('recent-imports').innerHTML='<div class="empty-state">No imports recorded yet.</div>';return}$('recent-imports').innerHTML=`<table><thead><tr><th>FILE</th><th>CATEGORY</th><th>RESULT</th><th>DATE</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.filename)}</td><td>${esc(r.category)}</td><td><span class="status-chip ${r.failed?'warning':'success'}">${r.imported} imported · ${r.failed} failed</span></td><td>${esc((r.created_at||'').replace('T',' ').slice(0,16))}</td></tr>`).join('')}</tbody></table>`}
async function refreshBuses(){try{buses=await getJSON('/api/buses');Object.keys(demoMarkers).forEach(k=>{const b=buses.find(x=>String(x.id)===String(k));if(b&&b.lat!=null&&b.lng!=null){trackingMap?.removeLayer(demoMarkers[k].marker);trackingMap?.removeLayer(demoMarkers[k].routeLine);delete demoMarkers[k];if(demoAnimation){cancelAnimationFrame(demoAnimation);demoAnimation=null}}});renderBusList();renderBusTable();upsertMarkers('overview',initMap('overview'));upsertMarkers('tracking',initTrackingMap());if(selectedBus)renderSelectedDetail();else if(trackingMap)fitFleet();const live=buses.some(b=>b.tracking_status==='LIVE GPS');$('nav-live-dot').style.background=live?'#44c8a1':'#a6b2c3'}catch(e){$('connection-label').textContent='Connection issue'}}
async function openMyBusTracking(){const data=role==='STUDENT'?window.studentData:window.driverData;const bus=data?.bus;if(!bus?.id){toast('No bus is assigned to this account yet.','error');return}navigate('tracking');await refreshBuses();if(!trackingMap)trackingMap=initTrackingMap();selectBus(Number(bus.id),true)}
function renderBusList(){if(!$('bus-list'))return;const q=($('bus-search')?.value||'').toLowerCase(),route=$('route-filter')?.value||'',status=$('status-filter')?.value||'';const filtered=buses.filter(b=>(!q||`${b.bus_no} ${b.route_name||''}`.toLowerCase().includes(q))&&(!route||String(b.route_id)===route)&&(!status||b.tracking_status===status));$('bus-list-count').textContent=`${filtered.length} of ${buses.length} buses`;$('bus-list').innerHTML=filtered.map(b=>`<div class="bus-list-item ${selectedBus===b.id?'selected':''}" onclick="selectBus(${b.id},true)"><div class="bus-avatar">🚌</div><div class="bus-list-copy"><b>${esc(b.bus_no)}</b><span>${esc(b.route_name||'Route not assigned')}</span></div><span class="gps-tag ${statusClass(b.tracking_status)}">${esc(b.tracking_status)}</span></div>`).join('')||'<div class="empty-state">No matching buses.</div>'}
async function startDemoBusMotion(bus){
 if(!trackingMap||!bus)return;
 const id=Number(bus.id);let path=[];
 try{
  if(!bus.route_id)throw new Error('This bus has no configured route.');
  const routeData=await getJSON('/api/routes');if(selectedBus!==id)return;
  const stops=(routeData.stops||[]).filter(s=>Number(s.route_id)===Number(bus.route_id)&&s.lat!==null&&s.lng!==null&&Number.isFinite(Number(s.lat))&&Number.isFinite(Number(s.lng))).sort((a,b)=>Number(a.sequence)-Number(b.sequence));
  if(!stops.length)throw new Error('No mapped destination stop is configured for this route. Ask the transport admin to add a stop with latitude and longitude.');
  const routePoints=stops.map(s=>[Number(s.lat),Number(s.lng)]);
  const campusPoint=[8.2436,77.6058];
  if(L.latLng(campusPoint).distanceTo(L.latLng(routePoints[0]))>100)routePoints.unshift(campusPoint);
  if(routePoints.length<2)throw new Error('Add at least one destination stop away from campus.');
  const coords=routePoints.map(p=>p[1]+','+p[0]).join(';');
  const response=await fetch('https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=false');
  if(!response.ok)throw new Error('Road routing service is unavailable. Try again later.');
  const roadData=await response.json();if(roadData.code!=='Ok')throw new Error(roadData.message||'No drivable road route was returned.');
  const coordinates=roadData.routes?.[0]?.geometry?.coordinates;if(!coordinates||coordinates.length<2)throw new Error('No drivable road route was returned.');
  path=coordinates.map(c=>[c[1],c[0]]);
 }catch(e){if(selectedBus===id){$('map-selected-label').textContent=bus.bus_no+' · route unavailable';toast(e.message,'error')}return}
 if(selectedBus!==id)return;
 const routeLine=L.polyline(path,{color:'#1685e8',weight:6,opacity:.9,lineCap:'round',lineJoin:'round'}).addTo(trackingMap);
 const previewSpeedKmh=25;
 const icon=L.divIcon({className:'joy-bus-icon',html:`<div class="bus-map-marker selected demo"><span>🚌</span><b>${esc(bus.bus_no)}</b><small>ROAD PREVIEW</small></div>`,iconSize:[150,40],iconAnchor:[75,20]});
 const marker=L.marker(path[0],{icon,zIndexOffset:1200}).addTo(trackingMap).bindPopup(`<div class="popup-bus"><b>${esc(bus.bus_no)} · ROAD ROUTE PREVIEW</b><p>Animated at a preview speed of ${previewSpeedKmh} km/h. This is not live vehicle GPS.</p></div>`);
 const lengths=[];let total=0;for(let i=0;i<path.length-1;i++){const d=L.latLng(path[i]).distanceTo(L.latLng(path[i+1]));lengths.push(d);total+=d}
 if(total<20){trackingMap.removeLayer(marker);trackingMap.removeLayer(routeLine);toast('Configured stops are too close to create a useful road preview.','error');return}
 demoMarkers[id]={marker,routeLine,speedKmh:previewSpeedKmh,totalMeters:total};
 trackingMap.fitBounds(routeLine.getBounds().pad(.2));$('map-selected-label').textContent=bus.bus_no+' · ROAD PREVIEW · '+previewSpeedKmh+' km/h';renderSelectedDetail();
 const duration=Math.max(10000,total/(previewSpeedKmh/3.6)*1000),started=performance.now();
 function frame(now){
  if(selectedBus!==id||!demoMarkers[id])return;
  const cycle=((now-started)/duration)%2,progress=cycle<=1?cycle:2-cycle;let target=progress*total,seg=0;
  while(seg<lengths.length-1&&target>lengths[seg]){target-=lengths[seg];seg++}
  const t=lengths[seg]?Math.min(1,target/lengths[seg]):0,A=path[seg],B=path[seg+1],point=[A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t];
  marker.setLatLng(point);if($('follow-bus')?.checked&&trackingMap.getZoom()>=13)trackingMap.panTo(point,{animate:false});
  demoAnimation=requestAnimationFrame(frame);
 }
 demoAnimation=requestAnimationFrame(frame);
}
async function selectBus(id,focus=false){
 clearHistoryOverlay();
 Object.keys(demoMarkers).forEach(k=>{const d=demoMarkers[k];if(d.marker)trackingMap?.removeLayer(d.marker);if(d.routeLine)trackingMap?.removeLayer(d.routeLine);delete demoMarkers[k]});
 if(demoAnimation){cancelAnimationFrame(demoAnimation);demoAnimation=null}
 selectedBus=Number(id);const bus=buses.find(x=>Number(x.id)===selectedBus);if(!bus)return;
 if(!trackingMap)trackingMap=initTrackingMap();trackingMap?.invalidateSize();
 Object.keys(markers.tracking).forEach(k=>{if(Number(k)!==selectedBus||bus.tracking_status!=='LIVE GPS'){trackingMap?.removeLayer(markers.tracking[k]);delete markers.tracking[k]}});
 renderBusList();renderSelectedDetail();
 const hasLiveGPS=bus.tracking_status==='LIVE GPS'&&bus.lat!==null&&bus.lat!==undefined&&bus.lng!==null&&bus.lng!==undefined&&Number.isFinite(Number(bus.lat))&&Number.isFinite(Number(bus.lng));
 if(hasLiveGPS){
  upsertMarkers('tracking',trackingMap);
  if(focus&&trackingMap){const point=[Number(bus.lat),Number(bus.lng)];trackingMap.setView(point,Math.max(trackingMap.getZoom(),16));const marker=markers.tracking[bus.id];if(marker)marker.openPopup()}
  $('map-selected-label').textContent=bus.bus_no+' · LIVE GPS';
 }else{
  $('map-selected-label').textContent=bus.bus_no+' · building road preview…';
  if(focus&&trackingMap)await startDemoBusMotion(bus);
 }
}
function renderSelectedDetail(){const b=buses.find(x=>x.id===selectedBus);if(!b){$('selected-bus-detail').innerHTML='<div class="empty-state">Choose a bus to see details.</div>';return}$('selected-bus-detail').innerHTML=`<div class="selected-title"><div class="bus-avatar">🚌</div><div><h3>${esc(b.bus_no)}</h3><p>${esc(b.route_name||'Route not assigned')}</p></div><span class="gps-tag ${statusClass(b.tracking_status)}">${esc(b.tracking_status)}</span></div><div class="detail-grid"><div class="detail-cell"><span>VEHICLE STATUS</span><b>${esc(b.status)}</b></div><div class="detail-cell"><span>SPEED</span><b>${b.speed!=null?Math.round(b.speed*3.6)+' km/h':(demoMarkers[b.id]?.speedKmh?demoMarkers[b.id].speedKmh+' km/h (preview)':'Unavailable')}</b></div><div class="detail-cell"><span>LAST UPDATE</span><b>${esc(formatAge(b.age_seconds))}</b></div><div class="detail-cell"><span>DRIVER</span><b>${esc(b.driver_name||'Not assigned')}</b></div><div class="detail-cell"><span>CAPACITY</span><b>${b.capacity} seats</b></div><div class="detail-cell"><span>ETA</span><b>Unavailable</b></div></div><p style="font-size:9px;color:#9aa4b3;line-height:1.6;margin:12px 0 0">${b.tracking_status==='LIVE GPS'?'Device-reported GPS.':b.tracking_status==='STALE'?'Last known position is stale and is not live.':'No verified current GPS received. ETA is withheld.'}</p><button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="showHistory(${b.id})">View recent GPS history</button>`}
function showFleet(){
 Object.keys(demoMarkers).forEach(k=>{const d=demoMarkers[k];if(d.marker)trackingMap?.removeLayer(d.marker);if(d.routeLine)trackingMap?.removeLayer(d.routeLine);delete demoMarkers[k]});
 if(demoAnimation){cancelAnimationFrame(demoAnimation);demoAnimation=null}
 selectedBus=null;renderBusList();renderSelectedDetail();upsertMarkers('tracking',trackingMap);fitFleet();
}
function fitFleet(){if(!trackingMap)return;const pts=buses.filter(b=>b.lat!==null&&b.lat!==undefined&&b.lng!==null&&b.lng!==undefined&&Number.isFinite(Number(b.lat))&&Number.isFinite(Number(b.lng))).map(b=>[Number(b.lat),Number(b.lng)]);if(pts.length)trackingMap.fitBounds(pts,{padding:[30,30],maxZoom:14});else trackingMap.setView([8.2436,77.6058],13)}
let historyOverlay=null,historyPlaybackFrame=null;
function clearHistoryOverlay(){if(historyPlaybackFrame)cancelAnimationFrame(historyPlaybackFrame);historyPlaybackFrame=null;if(historyOverlay&&trackingMap){historyOverlay.forEach(layer=>trackingMap.removeLayer(layer))}historyOverlay=null}
async function showHistory(id){
 try{
  const data=await getJSON(`/api/tracking/buses/${id}/history`);
  if(!data.length){toast('No GPS history has been received for this bus yet.','error');return}
  const points=data.filter(p=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))).sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at));
  if(!points.length){toast('GPS history contains no valid map coordinates.','error');return}
  const map=initTrackingMap();if(!map)return;clearHistoryOverlay();
  const latlngs=points.map(p=>[Number(p.lat),Number(p.lng)]),layers=[];
  if(latlngs.length>1){const line=L.polyline(latlngs,{color:'#7b3db1',weight:5,opacity:.82,dashArray:'8 7'}).addTo(map);layers.push(line)}
  const first=L.circleMarker(latlngs[0],{radius:7,color:'#fff',weight:2,fillColor:'#16a36a',fillOpacity:1}).addTo(map).bindPopup('Oldest recorded GPS point<br>'+esc(points[0].recorded_at));
  const last=L.circleMarker(latlngs[latlngs.length-1],{radius:7,color:'#fff',weight:2,fillColor:'#d44b4b',fillOpacity:1}).addTo(map).bindPopup('Latest recorded GPS point<br>'+esc(points[points.length-1].recorded_at));
  layers.push(first,last);
  const replay=L.circleMarker(latlngs[0],{radius:9,color:'#35105f',weight:3,fillColor:'#b98ad9',fillOpacity:1}).addTo(map);layers.push(replay);
  historyOverlay=layers;map.fitBounds(latlngs,{padding:[36,36],maxZoom:16});
  if(points.length>1){
   let segment=0,progress=0,lastFrame=0;
   const step=now=>{if(!historyOverlay||!historyOverlay.includes(replay))return;if(!lastFrame)lastFrame=now;progress+=(now-lastFrame)/900;lastFrame=now;
    while(progress>=1&&segment<latlngs.length-2){progress-=1;segment++}
    const t=Math.min(1,progress),a=latlngs[segment],b=latlngs[Math.min(segment+1,latlngs.length-1)];
    replay.setLatLng([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
    if(segment<latlngs.length-1)historyPlaybackFrame=requestAnimationFrame(step);
    else{replay.setLatLng(latlngs[latlngs.length-1]);historyPlaybackFrame=null}
   };
   historyPlaybackFrame=requestAnimationFrame(step);
  }
  const bus=buses.find(x=>Number(x.id)===Number(id));
  toast(`${bus?.bus_no||'Bus'}: showing ${points.length} recorded GPS positions from oldest to latest.`);
 }catch(e){toast(e.message,'error')}
}
function renderBusTable(){if(!$('fleet-table'))return;const q=($('fleet-search')?.value||'').toLowerCase(),rows=buses.filter(b=>`${b.bus_no} ${b.registration||''} ${b.route_name||''}`.toLowerCase().includes(q));$('fleet-total').textContent=`${rows.length} buses`;$('fleet-table').innerHTML=rows.map(b=>`<tr><td><div class="bus-cell"><span class="small-bus-icon">🚌</span><b>${esc(b.bus_no)}</b></div></td><td>${esc(b.registration||'—')}</td><td>${esc(b.route_name||'Unassigned')}</td><td>${b.capacity}</td><td><span class="status-chip ${b.status==='Active'?'success':b.status==='Maintenance'?'warning':'neutral'}">${esc(b.status)}</span></td><td><span class="gps-tag ${statusClass(b.tracking_status)}">${esc(b.tracking_status)}</span></td><td>${esc(formatAge(b.age_seconds))}</td><td><button class="text-button" onclick="navigate('tracking');selectBus(${b.id},true)">Map ↗</button></td></tr>`).join('')||'<tr><td colspan="8" class="empty-state">No buses found.</td></tr>'}
async function loadRoutes(){try{const d=await getJSON('/api/routes');routes=d.routes;stops=d.stops;$('route-filter').innerHTML='<option value="">All routes</option>'+routes.map(r=>`<option value="${r.id}">${esc(r.route_code)} · ${esc(r.name)}</option>`).join('');$('route-grid').innerHTML=routes.map(r=>`<div class="route-card"><div class="route-card-head"><div class="route-code">${esc(r.route_code)}</div><div><h3>${esc(r.name)}</h3><p>${esc(r.origin||'Start not set')} → ${esc(r.destination||'Destination not set')}</p></div></div><div class="route-meta"><span>▰ ${r.bus_count} buses</span><span>⌖ ${r.stop_count} stops</span><span>${r.active?'Active':'Inactive'}</span></div><div class="route-notes">${esc(r.notes||'Route details pending verification')}</div></div>`).join('')}catch(e){toast(e.message,'error')}}
async function loadStudents(){try{const d=await getJSON('/api/students');const q=($('student-search')?.value||'').toLowerCase();const rows=d.filter(x=>`${x.name} ${x.register_no}`.toLowerCase().includes(q));$('student-table').innerHTML=rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.register_no)}</td><td>${esc(x.department||'—')}</td><td>${esc(x.academic_year||'—')}</td><td>${esc(x.bus_no||'—')}</td><td>${esc(x.route_name||'—')}</td></tr>`).join('')||'<tr><td colspan="6" class="empty-state">No student records. Import a student CSV/XLSX to get started.</td></tr>'}catch(e){$('student-table').innerHTML='<tr><td colspan="6" class="empty-state">Student data endpoint unavailable.</td></tr>'}}
async function loadAlerts(){try{const data=await getJSON('/api/alerts');$('alerts-list').innerHTML=data.map(a=>`<div class="alert-row"><div class="alert-symbol">!</div><div class="alert-copy"><b>${esc(a.category)} · ${esc(a.bus_no||'System')}</b><p>${esc(a.message)}</p><small>${esc(a.created_at)} · ${esc(a.status)}</small></div>${a.status==='Open'&&role==='ADMIN'?`<button class="btn btn-secondary" onclick="ackAlert(${a.id})">Acknowledge</button>`:''}</div>`).join('')||'<div class="empty-state">No alerts recorded. Stale GPS is indicated on the map and fleet list.</div>'}catch(e){toast(e.message,'error')}}
async function ackAlert(id){try{const r=await fetch(`/api/alerts/${id}/ack`,{method:'POST',headers:{'X-CSRF-Token':csrf}});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Alert acknowledged');loadAlerts();loadOverview()}catch(e){toast(e.message,'error')}}
function chooseImport(category){$('import-category').value=category;$('upload-heading').textContent=`Upload ${category} spreadsheet`;$('import-result').classList.add('hidden');$('import-file').value='';$('import-file').click()}
$('import-file')?.addEventListener('change',()=>{if($('import-file').files[0])$('upload-heading').textContent=`Selected: ${$('import-file').files[0].name}`});
async function submitImport(e){e.preventDefault();const file=$('import-file').files[0];if(!file){toast('Choose a CSV or XLSX file first.','error');return}const fd=new FormData();fd.append('file',file);fd.append('mode',$('import-add-only')?.checked?'add_only':'upsert');const category=$('import-category').value;const result=$('import-result');result.classList.remove('hidden','error');result.textContent='Uploading and validating rows…';try{const r=await fetch(`/api/import/${category}`,{method:'POST',headers:{'X-CSRF-Token':csrf},body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error||'Import failed');result.innerHTML=`<b>Import finished</b><br>New records: ${d.imported}<br>${d.mode==='add_only'?'Existing records skipped':'Updated/existing'}: ${d.updated_or_existing}<br>Failed rows: ${d.failed}`+(d.errors?.length?'<br><br>'+d.errors.slice(0,15).map(x=>`Row ${x.row}: ${esc(x.error)}`).join('<br>'):'');if(d.failed)result.classList.add('error');toast('Import processing finished');loadOverview();refreshBuses();if(category==='routes')loadRoutes();if(category==='students')loadStudents()}catch(err){result.classList.add('error');result.textContent=err.message;toast(err.message,'error')}}
function openBusModal(){modalKind='bus';$('modal-title').textContent='Add a bus';$('modal-fields').innerHTML=`<div class="form-field"><label>Bus number *</label><input name="bus_no" placeholder="JOY-11" required></div><div class="form-field"><label>Registration number</label><input name="registration" placeholder="TN 00 AB 0000"></div><div class="form-field"><label>Capacity</label><input name="capacity" type="number" min="1" max="100" value="40" required></div><div class="form-field"><label>Bus model</label><input name="model" placeholder="Model / make"></div><div class="form-field full"><label>Route</label><select name="route_id"><option value="">Unassigned</option>${routes.map(r=>`<option value="${r.id}">${esc(r.route_code)} · ${esc(r.name)}</option>`).join('')}</select></div><div class="form-field full"><label>Fleet status</label><select name="status"><option>Active</option><option>Inactive</option><option>Maintenance</option><option>Out of service</option></select></div>`;$('modal-backdrop').classList.remove('hidden')}
function openRouteModal(){modalKind='route';$('modal-title').textContent='Add a route';$('modal-fields').innerHTML=`<div class="form-field"><label>Route ID *</label><input name="route_code" placeholder="R11" required></div><div class="form-field"><label>Route name *</label><input name="name" placeholder="Route name" required></div><div class="form-field"><label>Starting point</label><input name="origin" placeholder="Origin"></div><div class="form-field"><label>Destination</label><input name="destination" placeholder="Destination"></div><div class="form-field full"><label>Notes / coordinate verification</label><input name="notes" placeholder="Stops and coordinates pending verification"></div>`;$('modal-backdrop').classList.remove('hidden')}
function closeModal(){$('modal-backdrop').classList.add('hidden')}
async function submitModal(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const route=modalKind==='route';try{const r=await fetch(route?'/api/routes':'/api/buses',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(d)});const j=await r.json();if(!r.ok)throw new Error(j.error);closeModal();toast(route?'Route created':'Bus added');await refreshBuses();if(route)loadRoutes();else navigate('buses')}catch(err){toast(err.message,'error')}}
function csvDownload(name,rows){if(!rows.length){toast('No records to export yet.','error');return}const headers=Object.keys(rows[0]);const csv=[headers.join(','),...rows.map(r=>headers.map(h=>'"'+String(r[h]??'').replace(/"/g,'""')+'"').join(','))].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
function exportBuses(){csvDownload('joy-bus-inventory.csv',buses.map(b=>({bus_no:b.bus_no,registration:b.registration,route:b.route_name,capacity:b.capacity,status:b.status,gps_status:b.tracking_status,last_update:b.recorded_at||''})))}
async function exportRoutes(){if(!routes.length)await loadRoutes();csvDownload('joy-routes.csv',routes.map(r=>({route_code:r.route_code,name:r.name,origin:r.origin,destination:r.destination,buses:r.bus_count,stops:r.stop_count,notes:r.notes})))}
async function exportStudents(){try{const d=await getJSON('/api/students');csvDownload('joy-student-transport.csv',d)}catch(e){toast(e.message,'error')}}
function exportTracking(){csvDownload('joy-tracking-status.csv',buses.map(b=>({bus_no:b.bus_no,route:b.route_name,gps_status:b.tracking_status,lat:b.lat??'',lng:b.lng??'',speed:b.speed??'',last_update:b.recorded_at??'',source:b.source??''})))}
function downloadTemplate(cat){window.location.href=`/templates/${cat}.csv`}
function setTheme(dark){document.body.classList.toggle('dark-mode',dark);try{localStorage.setItem('joy-theme',dark?'dark':'light')}catch(e){}}$('theme-toggle').addEventListener('click',()=>setTheme(!document.body.classList.contains('dark-mode')));try{setTheme(localStorage.getItem('joy-theme')==='dark')}catch(e){setTheme(false)}
function setupRole(){
 const views={
  ADMIN:['overview','tracking','buses','routes','students','alerts','reports','imports','admin-data','admin-students','admin-drivers','admin-buses','admin-routes','admin-stops','admin-trips','admin-attendance','admin-maintenance','admin-permissions','admin-settings'],
  STUDENT:['student-dashboard','student-profile','student-bus','tracking','student-route','student-arrival','student-notifications','student-attendance','student-emergency','student-support','student-password'],
  DRIVER:['driver-dashboard','driver-profile','driver-bus','driver-trips','driver-start','driver-end','driver-gps','driver-route','driver-status','driver-attendance','driver-emergency','driver-notifications','driver-issue','driver-password']
 };
 const allowed=views[role]||views.STUDENT;
 document.querySelectorAll('.nav-item[data-view]').forEach(el=>{
  const admin=el.classList.contains('admin-only'),student=el.classList.contains('student-only'),driver=el.classList.contains('driver-only');
  const visible=role==='ADMIN'?admin:role==='STUDENT'?student:driver;
  el.classList.toggle('hidden',!visible);
 });
 document.querySelectorAll('.nav-section-label.admin-only,.admin-only:not(.nav-item):not(.nav-section-label)').forEach(el=>el.classList.toggle('hidden',role!=='ADMIN'));
 document.querySelectorAll('.student-only:not(.nav-item)').forEach(el=>el.classList.toggle('hidden',role!=='STUDENT'));
 document.querySelectorAll('.driver-only:not(.nav-item)').forEach(el=>el.classList.toggle('hidden',role!=='DRIVER'));
 document.querySelectorAll('.nav-section-label.student-only').forEach(el=>el.classList.toggle('hidden',role!=='STUDENT'));
 document.querySelectorAll('.nav-section-label.driver-only').forEach(el=>el.classList.toggle('hidden',role!=='DRIVER'));
 document.querySelectorAll('.non-admin-only').forEach(el=>el.classList.add('hidden'));
 document.querySelectorAll('.view').forEach(v=>{v.classList.remove('active');v.classList.toggle('hidden',!allowed.includes(v.id.replace('view-','')))});
 const home=role==='ADMIN'?'overview':role==='STUDENT'?'student-dashboard':'driver-dashboard';
 const target=$('view-'+home);if(target)target.classList.add('active');
 document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===home&&!n.classList.contains('hidden')));
 const labels={ADMIN:'Administrator workspace',STUDENT:'Student travel portal',DRIVER:'Driver operations portal'};
 $('today-date').textContent=labels[role]||'Transport workspace';$('crumb').textContent=(role==='ADMIN'?'Admin Portal':role==='STUDENT'?'Student Portal':'Driver Portal')+' / '+(role==='ADMIN'?'Dashboard':role==='STUDENT'?'Student Dashboard':'Driver Dashboard');
 const heading=document.querySelector('#view-overview .page-heading');
 if(role!=='ADMIN'&&heading)heading.classList.add('hidden');
 if(role!=='ADMIN')document.querySelectorAll('#view-overview .metric-grid,#view-overview .dashboard-grid,#view-overview .bottom-grid').forEach(x=>x.classList.add('hidden'));
 if(role==='DRIVER'){
  $('gps-start')?.addEventListener('click',startDriverGPS);
  $('gps-stop')?.addEventListener('click',stopDriverGPS);
 }
 if(role==='STUDENT')loadStudentPortal();
 if(role==='DRIVER')loadDriverPortal();
}
async function loadStudentPortal(){
 try{const d=await getJSON('/api/student/me');window.studentData=d;const x=d.student||{},b=d.bus||{},r=d.route||{};
 const busHtml=b.bus_no?'<b>'+esc(b.bus_no)+'</b><p>'+esc(b.registration||'')+' · '+esc(b.driver_name||'Driver not assigned')+'</p><p>GPS: '+esc(b.tracking_status||'NOT CONNECTED')+'</p>':'No bus assignment is linked to your student account yet.';
 const routeHtml=r.name?'<b>'+esc(r.route_code)+' · '+esc(r.name)+'</b><p>'+esc(r.origin||'Start not set')+' → '+esc(r.destination||'Destination not set')+'</p><ol>'+((d.stops||[]).map(z=>'<li>'+esc(z.name)+'</li>').join(''))+'</ol>':'No route assigned.';
 const studentBusAction=b.id?'<button class="btn btn-primary" onclick="openMyBusTracking()">Track this bus on map</button>':'';if($('student-bus-card'))$('student-bus-card').innerHTML=busHtml+studentBusAction;if($('student-bus-detail'))$('student-bus-detail').innerHTML=busHtml+studentBusAction;
 if($('student-route-detail'))$('student-route-detail').innerHTML=routeHtml;
 const profile='<dl class="portal-dl"><dt>Name</dt><dd>'+esc(x.name||d.user.full_name)+'</dd><dt>Register number</dt><dd>'+esc(x.register_no||d.user.username)+'</dd><dt>Department</dt><dd>'+esc(x.department||'—')+'</dd><dt>Academic year</dt><dd>'+esc(x.academic_year||'—')+'</dd></dl><form onsubmit="updateStudentProfile(event)" class="profile-edit-form"><label>Contact phone<input name="phone" maxlength="30" value="'+esc(x.phone||'')+'"></label><button class="btn btn-primary">Save profile</button></form>';
 if($('student-profile-card'))$('student-profile-card').innerHTML=profile;
 if($('student-metrics'))$('student-metrics').innerHTML=[['Assigned bus',b.bus_no||'—'],['Route',r.route_code||'—'],['Attendance records',(d.attendance||[]).length]].map(a=>'<div class="metric-card"><div class="metric-top"><span>'+a[0]+'</span></div><div class="metric-value">'+esc(a[1])+'</div></div>').join('');
 const eta='ETA is not available until verified route timings and current GPS data are configured.';
 if($('student-arrival-card'))$('student-arrival-card').textContent=eta;if($('student-arrival-detail'))$('student-arrival-detail').textContent=eta;
 if($('student-attendance-list'))$('student-attendance-list').innerHTML=(d.attendance||[]).length?'<table><thead><tr><th>DATE</th><th>BUS</th><th>STATUS</th></tr></thead><tbody>'+d.attendance.map(a=>'<tr><td>'+esc(a.boarding_time)+'</td><td>'+esc(a.bus_no||'—')+'</td><td>'+esc(a.status)+'</td></tr>').join('')+'</tbody></table>':'<div class="empty-state">No attendance records found.</div>';
 await loadPortalNotifications('student-notification-list');
 }catch(e){toast(e.message,'error')}
}
async function updateStudentProfile(e){e.preventDefault();const phone=new FormData(e.target).get('phone');try{const r=await fetch('/api/student/profile',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({phone})});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Profile updated');loadStudentPortal()}catch(err){toast(err.message,'error')}}
async function loadPortalNotifications(id){try{const d=await getJSON('/api/notifications');$(id).innerHTML=d.length?d.map(n=>'<article class="portal-notice"><b>'+esc(n.title)+'</b><p>'+esc(n.message)+'</p><small>'+esc(n.created_at)+'</small></article>').join(''):'<div class="empty-state">No notifications yet.</div>'}catch(e){$(id).textContent='Notifications unavailable.'}}
async function loadDriverPortal(){
 try{const d=await getJSON('/api/driver/me');window.driverData=d;const b=d.bus||{},t=d.trips||[];
 const busHtml=b.bus_no?'<b>'+esc(b.bus_no)+'</b><p>'+esc(b.registration||'')+' · '+esc(b.route_name||'No route assigned')+'</p><p>'+esc(b.status||'')+' · GPS '+esc(b.tracking_status||'NOT CONNECTED')+'</p>':'No bus is assigned to this driver account.';
 const driverBusAction=b.id?'<button class="btn btn-primary" onclick="openMyBusTracking()">Track this bus on map</button>':'';if($('driver-bus-card'))$('driver-bus-card').innerHTML=busHtml+driverBusAction;if($('driver-bus-detail'))$('driver-bus-detail').innerHTML=busHtml+driverBusAction;
 const profile='<dl class="portal-dl"><dt>Name</dt><dd>'+esc(d.user.full_name)+'</dd><dt>Username</dt><dd>'+esc(d.user.username)+'</dd><dt>Assigned bus</dt><dd>'+esc(b.bus_no||'—')+'</dd></dl>';
 if($('driver-profile-card'))$('driver-profile-card').innerHTML=profile;
 const rows=t.map(x=>'<tr><td>'+esc(x.id)+'</td><td>'+esc(x.route_name||'—')+'</td><td>'+esc(x.planned_start||'—')+'</td><td>'+esc(x.status)+'</td><td>'+(x.status==='Scheduled'?'<button class="btn btn-primary" onclick="setDriverTrip('+x.id+',\'In progress\')">Start</button>':x.status==='In progress'?'<button class="btn btn-secondary" onclick="setDriverTrip('+x.id+',\'Completed\')">End</button>':'—')+'</td></tr>').join('');
 const table=rows?'<table><thead><tr><th>TRIP</th><th>ROUTE</th><th>START</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="empty-state">No trips are assigned.</div>';
 if($('driver-trip-list'))$('driver-trip-list').innerHTML=table;if($('driver-trip-summary'))$('driver-trip-summary').innerHTML=table;
 if($('driver-start-panel'))$('driver-start-panel').innerHTML=table;if($('driver-end-panel'))$('driver-end-panel').innerHTML=table;if($('driver-status-panel'))$('driver-status-panel').innerHTML=table;
 if($('driver-route-detail'))$('driver-route-detail').innerHTML='<b>'+esc(b.route_name||'No route assigned')+'</b><ol>'+(d.stops||[]).map(z=>'<li>'+esc(z.name)+' '+(z.eta?'· '+esc(z.eta):'')+'</li>').join('')+'</ol>';
 if($('driver-attendance-panel'))$('driver-attendance-panel').innerHTML='<form onsubmit="submitDriverAttendance(event)" class="inline-form"><label>Student register number<input name="register_no" required placeholder="Enter register number"></label><button class="btn btn-primary">Record boarding</button></form>' + ((d.attendance||[]).length?'<table><thead><tr><th>STUDENT</th><th>REGISTER NO.</th><th>BOARDING TIME</th><th>STATUS</th></tr></thead><tbody>'+d.attendance.map(a=>'<tr><td>'+esc(a.student_name)+'</td><td>'+esc(a.register_no)+'</td><td>'+esc(a.boarding_time)+'</td><td>'+esc(a.status)+'</td></tr>').join('')+'</tbody></table>':'<div class="empty-state">No attendance records are available for your assigned bus.</div>');
 if($('driver-metrics'))$('driver-metrics').innerHTML=[['Assigned bus',b.bus_no||'—'],['Trips',t.length],['Active trips',t.filter(x=>x.status==='In progress').length]].map(a=>'<div class="metric-card"><div class="metric-top"><span>'+a[0]+'</span></div><div class="metric-value">'+esc(a[1])+'</div></div>').join('');
 await loadPortalNotifications('driver-notification-list');
 }catch(e){toast(e.message,'error')}
}
async function setDriverTrip(id,status){try{const r=await fetch('/api/driver/trips/'+id,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({status})});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Trip status updated');loadDriverPortal()}catch(e){toast(e.message,'error')}}
async function submitDriverAttendance(e){e.preventDefault();const reg=new FormData(e.target).get('register_no');try{const r=await fetch('/api/driver/attendance',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({register_no:reg})});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Boarding attendance recorded');loadDriverPortal()}catch(err){toast(err.message,'error')}}
async function submitDriverIssue(e,kind){e.preventDefault();const fd=new FormData(e.target);try{const r=await fetch('/api/driver/issues',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({kind,category:fd.get('category')||kind,description:fd.get('description')})});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Report submitted to transport administration');e.target.reset()}catch(err){toast(err.message,'error')}}
async function changeAccountPassword(e){e.preventDefault();const fd=new FormData(e.target);try{const r=await fetch('/api/account/password',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({current_password:fd.get('current_password'),new_password:fd.get('new_password')})});const d=await r.json();if(!r.ok)throw new Error(d.error);toast('Password updated successfully');e.target.reset()}catch(err){toast(err.message,'error')}}
function startDriverGPS(){if(!navigator.geolocation){toast('This browser does not support GPS.','error');return}if(!window.isSecureContext&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'){toast('Browser GPS requires HTTPS or localhost.','error');return}if(driverWatch!==null)return;driverWatch=navigator.geolocation.watchPosition(async pos=>{try{const c=pos.coords;const r=await fetch('/api/driver/location',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({latitude:c.latitude,longitude:c.longitude,speed:c.speed,heading:c.heading,accuracy:c.accuracy})});const d=await r.json();if(!r.ok)throw new Error(d.error);$('connection-label').textContent='GPS sharing';refreshBuses()}catch(e){toast(e.message,'error');stopDriverGPS()}},err=>{toast('GPS unavailable: '+err.message,'error');stopDriverGPS()},{enableHighAccuracy:true,maximumAge:5000,timeout:15000});$('gps-start').disabled=true;$('gps-stop').disabled=false;toast('GPS sharing started. Allow location permission when prompted.')}
function stopDriverGPS(){if(driverWatch!==null)navigator.geolocation.clearWatch(driverWatch);driverWatch=null;if($('gps-start'))$('gps-start').disabled=false;if($('gps-stop'))$('gps-stop').disabled=true;toast('GPS sharing stopped.')}
async function checkIntegration(){try{const d=await getJSON('/health');if(d.gps_ingestion==='configured'){$('gps-integration-text').textContent='Authenticated tracking token configured';$('gps-integration-status').textContent='Configured';$('gps-integration-status').className='status-chip success'}}catch(e){}}
async function boot(){setupRole();$('today-date').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});if(role==='ADMIN'){initMap('overview');await loadOverview();}await refreshBuses();await loadRoutes();checkIntegration();refreshTimer=setInterval(()=>{refreshBuses();if(role==='ADMIN'&&$('view-overview').classList.contains('active'))loadOverview();},15000);}
boot();
