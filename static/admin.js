const adminPages={
'admin-students':{resource:'students',title:'Student Management',desc:'Create, update, assign and remove student transport records.',fields:['register_no','name','department','academic_year','phone','bus_id','route_id','stop_id','password']},
'admin-drivers':{resource:'drivers',title:'Driver Management',desc:'Create driver accounts and manage driver availability.',fields:['username','full_name','password']},
'admin-buses':{resource:'buses',title:'Bus Management',desc:'Manage bus registration, capacity, availability and driver/route assignment.',fields:['bus_no','registration','capacity','model','status','route_id','driver_id']},
'admin-routes':{resource:'routes',title:'Route Management',desc:'Create and maintain routes and destinations.',fields:['route_code','name','origin','destination','notes']},
'admin-stops':{resource:'stops',title:'Stop Management',desc:'Maintain stop order, map coordinates and arrival timings.',fields:['route_id','name','sequence','lat','lng','eta','coord_status']},
'admin-trips':{resource:'trips',title:'Trip Management',desc:'Schedule trips, assign drivers and buses, then update trip status.',fields:['bus_id','route_id','driver_id','planned_start','planned_end','status']},
'admin-attendance':{resource:'attendance',title:'Attendance Management',desc:'Record and review student boarding records.',fields:['student_id','bus_id','trip_id','boarding_time','status']},
'admin-maintenance':{resource:'maintenance',title:'Maintenance Management',desc:'Record vehicle faults, servicing, repair details and resolution status.',fields:['bus_id','category','description','status','resolution']},
'admin-permissions':{resource:'permissions',title:'User Roles & Permissions',desc:'Review the three supported roles and protected access boundaries.',fields:[]},
'admin-settings':{resource:'settings',title:'System Settings & Activity Logs',desc:'Save operational key/value settings and inspect administrator audit history.',fields:['key','value']}
};
let activeAdminResource='admin-students';
const adminLabels={register_no:'Student register number',name:'Student full name',department:'Department',academic_year:'Academic year',phone:'Phone number',bus_id:'Bus database ID',route_id:'Route database ID',stop_id:'Stop database ID',password:'Initial login password (optional for students; required for drivers)',username:'Driver login username',full_name:'Driver full name',bus_no:'Bus number',registration:'Registration number',capacity:'Seating capacity',model:'Vehicle model',status:'Status',route_code:'Route code',origin:'Starting point',destination:'Destination',notes:'Route notes',sequence:'Stop sequence',lat:'Latitude',lng:'Longitude',eta:'Scheduled arrival time',coord_status:'Coordinate accuracy',driver_id:'Driver user ID',planned_start:'Planned start date/time',planned_end:'Planned end date/time',student_id:'Student record ID',trip_id:'Trip ID',boarding_time:'Boarding date/time (ISO format)',category:'Issue category',description:'Problem description',resolution:'Repair / resolution details',key:'Setting name',value:'Setting value'};
const adminEsc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const adminGet=async url=>{const r=await fetch(url,{credentials:'same-origin'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load records');return d};
const adminCall=async(url,method,data)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:data?JSON.stringify(data):undefined,credentials:'same-origin'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d};
const adminOriginalNavigate=navigate;
navigate=function(view,record=true){
 if(!adminPages[view])return adminOriginalNavigate(view,record);
 if(role!=='ADMIN'){toast('Administrator access only.','error');return}
 if(record&&view!==activeAdminResource){viewHistory.push(view);if(viewHistory.length>30)viewHistory.shift()}
 document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
 $('view-admin-data').classList.add('active');
 document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));
 $('crumb').textContent=adminPages[view].title;$('sidebar').classList.remove('open');
 activeAdminResource=view;loadAdminResource(view);
};
function adminAddRecord(){
 const p=adminPages[activeAdminResource];if(!p||!p.fields.length)return;
 const form=$('admin-module-form');
 form.innerHTML='<form class="admin-inline-form" id="admin-create-form"><h3>Add '+adminEsc(p.title.replace(' Management',''))+'</h3><div class="admin-field-grid">'+p.fields.map(f=>'<label>'+adminEsc(adminLabels[f]||f)+'<input name="'+f+'" '+(['register_no','name','username','full_name','password','bus_no','route_code','category','description','key','value'].includes(f)?'required':'')+'></label>').join('')+'</div><button class="btn btn-primary" type="submit">Save record</button> <button class="btn btn-secondary" type="button" onclick="$(\'admin-module-form\').innerHTML=\'\'">Cancel</button></form>';
 $('admin-create-form').addEventListener('submit',async e=>{
  e.preventDefault();const data=Object.fromEntries(new FormData(e.target).entries());Object.keys(data).forEach(k=>{if(data[k]==='')delete data[k]});
  try{await adminCall('/api/admin/'+p.resource,'POST',data);toast('Record saved to database');loadAdminResource(activeAdminResource);loadOverview()}catch(err){toast(err.message,'error')}
 });
}
async function adminEditRecord(resource,id){
 const p=adminPages[activeAdminResource];const allowed=p.fields.filter(f=>f!=='password');
 const raw=prompt('Enter the fields to update as JSON. Allowed fields: '+allowed.join(', '),'{}');if(raw===null)return;
 try{const data=JSON.parse(raw);await adminCall('/api/admin/'+resource+'/'+id,'PATCH',data);toast('Record updated');loadAdminResource(activeAdminResource)}catch(e){toast(e.message,'error')}
}
async function adminDeleteRecord(resource,id){
 if(!confirm('Delete this record? The action is logged. Linked records may prevent deletion.'))return;
 try{await adminCall('/api/admin/'+resource+'/'+id,'DELETE');toast('Record deleted');loadAdminResource(activeAdminResource);loadOverview()}catch(e){toast(e.message,'error')}
}
async function loadAdminResource(view){
 const p=adminPages[view];if(!p)return;
 $('admin-module-title').textContent=p.title;$('admin-module-description').textContent=p.desc;
 $('admin-add-button').classList.toggle('hidden',view==='admin-permissions');
 $('admin-module-form').innerHTML='';
 try{
  let rows=await adminGet('/api/admin/'+p.resource);
  if(view==='admin-settings'){const logs=await adminGet('/api/admin/logs');rows=rows.map(x=>({...x,record_type:'Setting'})).concat(logs.map(x=>({...x,record_type:'Audit log'})));}
  const cols=view==='admin-permissions'?['role','access']:view==='admin-settings'?['record_type','key','value','username','action','details','created_at']:['id',...p.fields.filter(f=>f!=='password')];
  $('admin-table-head').innerHTML='<tr>'+cols.map(c=>'<th>'+adminEsc(c.replaceAll('_',' ').toUpperCase())+'</th>').join('')+'<th>ACTIONS</th></tr>';
  $('admin-table-body').innerHTML=rows.map(row=>'<tr>'+cols.map(c=>'<td>'+adminEsc(row[c])+'</td>').join('')+'<td>'+(row.id&&view!=='admin-settings'&&view!=='admin-permissions'?'<button class="text-button" onclick="adminEditRecord(\''+p.resource+'\','+row.id+')">Edit</button> <button class="text-button" onclick="adminDeleteRecord(\''+p.resource+'\','+row.id+')">Delete</button>':'—')+'</td></tr>').join('')||'<tr><td colspan="'+(cols.length+1)+'">No records found.</td></tr>';
 }catch(e){toast(e.message,'error')}
}
if(role==='ADMIN'){
 document.querySelectorAll('.nav-item[data-view^="admin-"]').forEach(n=>n.addEventListener('click',()=>navigate(n.dataset.view)));
}

async function loadAdminAnnouncements(){
 if(role!=='ADMIN')return;
 let panel=document.getElementById('admin-announcements-panel');
 if(!panel){panel=document.createElement('section');panel.id='admin-announcements-panel';panel.className='panel';const target=document.querySelector('#view-alerts .page-heading');if(target)target.insertAdjacentElement('afterend',panel);}
 if(!panel)return;
 try{const rows=await adminGet('/api/admin/notifications');panel.innerHTML='<div class="panel-header"><div><h3>Announcements</h3><p>Publish transport updates to the selected audience.</p></div><button class="btn btn-primary" id="admin-send-announcement">＋ New announcement</button></div>'+ (rows.length?rows.map(x=>'<div class="alert-row"><div class="alert-copy"><b>'+adminEsc(x.title)+' · '+adminEsc(x.audience)+'</b><p>'+adminEsc(x.message)+'</p><small>'+adminEsc(x.created_at)+'</small></div></div>').join(''):'<p>No announcements have been published.</p>');document.getElementById('admin-send-announcement').onclick=async()=>{const title=prompt('Announcement title');if(!title)return;const message=prompt('Announcement message');if(!message)return;const audience=prompt('Audience: ALL, STUDENT or DRIVER','ALL');if(!audience)return;try{await adminCall('/api/admin/notifications','POST',{title,message,audience:audience.toUpperCase()});toast('Announcement saved');loadAdminAnnouncements()}catch(e){toast(e.message,'error')}};}catch(e){toast(e.message,'error')}
}
async function loadAdminReportSummary(){
 if(role!=='ADMIN')return;
 const host=document.querySelector('#view-reports .report-grid');if(!host)return;
 try{const d=await adminGet('/api/admin/reports');let panel=document.getElementById('admin-report-summary');if(!panel){panel=document.createElement('div');panel.id='admin-report-summary';panel.className='metric-grid';host.insertAdjacentElement('beforebegin',panel);}panel.innerHTML=Object.entries(d).map(([k,v])=>'<div class="metric-card"><div class="metric-top"><span>'+adminEsc(k.replaceAll('_',' '))+'</span></div><div class="metric-value">'+adminEsc(v)+'</div></div>').join('')}catch(e){toast(e.message,'error')}
}
document.querySelectorAll('.nav-item[data-view="alerts"]').forEach(n=>n.addEventListener('click',()=>setTimeout(loadAdminAnnouncements,150)));
document.querySelectorAll('.nav-item[data-view="reports"]').forEach(n=>n.addEventListener('click',()=>setTimeout(loadAdminReportSummary,150)));

async function loadRoleAnnouncements(){
 try{
  const rows=await adminGet('/api/notifications');let panel=document.getElementById('role-announcements');
  if(!panel){panel=document.createElement('section');panel.id='role-announcements';panel.className='panel';const heading=document.querySelector('#view-overview .page-heading');if(heading)heading.insertAdjacentElement('afterend',panel);}
  if(!panel)return;
  panel.innerHTML='<div class="panel-header"><div><h3>Transport announcements</h3><p>Latest updates for your account role.</p></div></div>'+(rows.length?rows.map(x=>'<div class="alert-row"><div class="alert-copy"><b>'+adminEsc(x.title)+'</b><p>'+adminEsc(x.message)+'</p><small>'+adminEsc(x.created_at)+'</small></div></div>').join(''):'<p>No new announcements.</p>');
 }catch(e){}
}
loadRoleAnnouncements();setInterval(loadRoleAnnouncements,60000);
