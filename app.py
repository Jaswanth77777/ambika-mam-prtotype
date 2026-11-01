import os, sqlite3, secrets, csv, io, json, math, time
from datetime import datetime, timezone
from functools import wraps
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('JOY_DB_PATH', '/tmp/joy_bus.db' if os.environ.get('VERCEL') else os.path.join(BASE_DIR, 'joy_bus.db'))
SECRET = os.environ.get('SECRET_KEY')
if not SECRET:
    SECRET = secrets.token_hex(32)
app = Flask(__name__)
app.secret_key = SECRET
app.config['MAX_CONTENT_LENGTH'] = 8 * 1024 * 1024
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('COOKIE_SECURE', '0') == '1'
CAMPUS = {'lat': 8.2436, 'lng': 77.6058, 'name': 'JOY University', 'address': 'Raja Nagar, Vadakangulam, Tirunelveli District, Tamil Nadu 627116'}


def db_conn():
    con = sqlite3.connect(DB_PATH, timeout=20)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    return con

def now_iso(): return datetime.now(timezone.utc).isoformat(timespec='seconds')

def init_db():
    with db_conn() as con:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, full_name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS routes(id INTEGER PRIMARY KEY, route_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, origin TEXT, destination TEXT, notes TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS buses(id INTEGER PRIMARY KEY, bus_no TEXT UNIQUE NOT NULL, registration TEXT DEFAULT '', capacity INTEGER NOT NULL DEFAULT 40, model TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Active', route_id INTEGER, driver_id INTEGER, created_at TEXT NOT NULL, FOREIGN KEY(route_id) REFERENCES routes(id), FOREIGN KEY(driver_id) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS stops(id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL, name TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 1, lat REAL, lng REAL, eta TEXT DEFAULT '', coord_status TEXT NOT NULL DEFAULT 'Approximate', FOREIGN KEY(route_id) REFERENCES routes(id) ON DELETE CASCADE, UNIQUE(route_id, sequence));
        CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY, register_no TEXT UNIQUE NOT NULL, name TEXT NOT NULL, department TEXT DEFAULT '', academic_year TEXT DEFAULT '', phone TEXT DEFAULT '', bus_id INTEGER, route_id INTEGER, stop_id INTEGER, FOREIGN KEY(bus_id) REFERENCES buses(id), FOREIGN KEY(route_id) REFERENCES routes(id), FOREIGN KEY(stop_id) REFERENCES stops(id));
        CREATE TABLE IF NOT EXISTS locations(id INTEGER PRIMARY KEY, bus_id INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, speed REAL, heading REAL, accuracy REAL, device_id TEXT DEFAULT '', source TEXT NOT NULL DEFAULT 'device', recorded_at TEXT NOT NULL, FOREIGN KEY(bus_id) REFERENCES buses(id));
        CREATE INDEX IF NOT EXISTS idx_locations_bus_time ON locations(bus_id, recorded_at DESC);
        CREATE TABLE IF NOT EXISTS trips(id INTEGER PRIMARY KEY, bus_id INTEGER NOT NULL, route_id INTEGER, driver_id INTEGER, planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, status TEXT NOT NULL DEFAULT 'Scheduled', FOREIGN KEY(bus_id) REFERENCES buses(id), FOREIGN KEY(route_id) REFERENCES routes(id), FOREIGN KEY(driver_id) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY, category TEXT NOT NULL, message TEXT NOT NULL, bus_id INTEGER, status TEXT NOT NULL DEFAULT 'Open', created_at TEXT NOT NULL, acknowledged_by INTEGER, FOREIGN KEY(bus_id) REFERENCES buses(id), FOREIGN KEY(acknowledged_by) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS import_jobs(id INTEGER PRIMARY KEY, filename TEXT NOT NULL, category TEXT NOT NULL, imported INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, created_at TEXT NOT NULL, summary TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, details TEXT DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id));
        ''')
        seed_users = [('admin',os.environ.get('INITIAL_ADMIN_PASSWORD','Admin@123'),'ADMIN','JOY Transport Admin'),('student','Student@123','STUDENT','Demo Student'),('driver','Driver@123','DRIVER','Demo Driver')]
        con.execute("DELETE FROM users WHERE role IN ('TRANSPORT_MANAGER','SECURITY')")
        for username, password, role, name in seed_users:
            con.execute('INSERT OR IGNORE INTO users(username,password_hash,role,full_name,created_at) VALUES(?,?,?,?,?)', (username, generate_password_hash(password), role, name, now_iso()))
        routes = [
            ('R01','Vencode via Colachel','Vadakangulam','Vencode','Route/stops need transport-office verification'),
            ('R02','Pettai via Tirunelveli','Vadakangulam','Pettai, Tirunelveli','Route/stops need transport-office verification'),
            ('R03','Kanyakumari','Vadakangulam','Kanyakumari','Route/stops need transport-office verification'),
            ('R04','Chettikulam','Vadakangulam','Chettikulam','Route/stops need transport-office verification'),
            ('R05','Nithiravilai via Kaliyakkavilai','Vadakangulam','Nithiravilai','Route/stops need transport-office verification'),
            ('R06','Thengapattanam via Rajakkamangalam','Vadakangulam','Thengapattanam','Route/stops need transport-office verification'),
            ('R07','Kalakkad','Vadakangulam','Kalakkad','Route/stops need transport-office verification'),
            ('R08','Thisayanvilai','Vadakangulam','Thisayanvilai','Route/stops need transport-office verification'),
            ('R09','Thalayuthu via Tirunelveli','Vadakangulam','Thalayuthu','Route/stops need transport-office verification'),
            ('R10','Ambasamudram','Vadakangulam','Ambasamudram','Route/stops need transport-office verification')]
        for r in routes: con.execute('INSERT OR IGNORE INTO routes(route_code,name,origin,destination,notes) VALUES(?,?,?,?,?)', r)
        driver_id = con.execute("SELECT id FROM users WHERE username='driver'").fetchone()['id']
        for i in range(1,11):
            con.execute('INSERT OR IGNORE INTO buses(bus_no,registration,capacity,model,status,route_id,driver_id,created_at) VALUES(?,?,?,?,?,?,?,?)', (f'JOY-{i:02d}', '', 40, 'Not specified', 'Active', i, driver_id if i == 1 else None, now_iso()))
        # Coordinates intentionally absent: no fabricated GPS is shown as live.
        for rid, stop_name in [(1,'Vadakangulam Campus'),(2,'Tirunelveli Bus Stand'),(3,'Kanyakumari'),(4,'Chettikulam'),(5,'Kaliyakkavilai'),(6,'Rajakkamangalam'),(7,'Kalakkad'),(8,'Thisayanvilai'),(9,'Thalayuthu'),(10,'Ambasamudram')]:
            con.execute('INSERT OR IGNORE INTO stops(route_id,name,sequence,coord_status) VALUES(?,?,?,?)', (rid, stop_name, 1, 'Approximate - verify'))

init_db()
with db_conn() as con:
    con.executescript("""
    CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, bus_id INTEGER, trip_id INTEGER, boarding_time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Present', FOREIGN KEY(student_id) REFERENCES students(id), FOREIGN KEY(bus_id) REFERENCES buses(id), FOREIGN KEY(trip_id) REFERENCES trips(id));
    CREATE TABLE IF NOT EXISTS maintenance(id INTEGER PRIMARY KEY, bus_id INTEGER NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Open', resolution TEXT DEFAULT '', reported_at TEXT NOT NULL, resolved_at TEXT, FOREIGN KEY(bus_id) REFERENCES buses(id));
    CREATE TABLE IF NOT EXISTS system_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, audience TEXT NOT NULL DEFAULT 'ALL', title TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, created_by INTEGER);
    """)


def current_user():
    if not session.get('uid'): return None
    with db_conn() as con: return con.execute('SELECT id,username,role,full_name FROM users WHERE id=? AND active=1', (session['uid'],)).fetchone()

def login_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not current_user(): return redirect(url_for('login'))
        return fn(*args, **kwargs)
    return wrapped

def roles_required(*roles):
    def dec(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            u=current_user()
            if not u: return jsonify({'error':'Login required'}),401
            if u['role'] not in roles: return jsonify({'error':'You do not have permission for this action'}),403
            return fn(*args, **kwargs)
        return wrapped
    return dec

def audit(action, details=''):
    u=current_user()
    with db_conn() as con: con.execute('INSERT INTO audit_logs(user_id,action,details,created_at) VALUES(?,?,?,?)',(u['id'] if u else None,action,details[:500],now_iso()))

@app.get('/login')
def login():
    if current_user(): return redirect(url_for('home'))
    return render_template('login.html')

@app.post('/login')
def login_post():
    username=request.form.get('username','').strip().lower(); password=request.form.get('password','')
    with db_conn() as con: user=con.execute('SELECT * FROM users WHERE username=? AND active=1',(username,)).fetchone()
    if not user or user['role'] not in ('ADMIN','STUDENT','DRIVER') or not check_password_hash(user['password_hash'],password):
        flash('Username or password is incorrect.','error'); return redirect(url_for('login'))
    session.clear(); session['uid']=user['id']; session['csrf']=secrets.token_urlsafe(24)
    audit('login', user['role']); return redirect(url_for('home'))

@app.post('/logout')
def logout():
    audit('logout'); session.clear(); return redirect(url_for('login'))

@app.get('/')
@login_required
def home():
    u=current_user()
    return render_template('index.html', user=dict(u), csrf=session.get('csrf',''), campus=CAMPUS)

@app.get('/api/overview')
@login_required
def overview():
    with db_conn() as con:
        counts={k:con.execute(q).fetchone()[0] for k,q in {
            'buses':'SELECT COUNT(*) FROM buses','active':'SELECT COUNT(*) FROM buses WHERE status="Active"','drivers':'SELECT COUNT(*) FROM users WHERE role="DRIVER" AND active=1','students':'SELECT COUNT(*) FROM students','routes':'SELECT COUNT(*) FROM routes WHERE active=1','stops':'SELECT COUNT(*) FROM stops','trips':'SELECT COUNT(*) FROM trips WHERE status="Scheduled" OR status="In progress"','alerts':'SELECT COUNT(*) FROM alerts WHERE status="Open"'}.items()}
        latest=con.execute('''SELECT b.id,b.bus_no,b.status,r.name route_name,l.lat,l.lng,l.speed,l.recorded_at,l.source FROM buses b LEFT JOIN routes r ON r.id=b.route_id LEFT JOIN locations l ON l.id=(SELECT id FROM locations WHERE bus_id=b.id ORDER BY recorded_at DESC,id DESC LIMIT 1) ORDER BY b.bus_no''').fetchall()
        recent=con.execute('SELECT filename,category,imported,skipped,failed,created_at FROM import_jobs ORDER BY id DESC LIMIT 5').fetchall()
    return jsonify({'counts':counts,'buses':[dict(x) for x in latest],'imports':[dict(x) for x in recent],'campus':CAMPUS})

@app.get('/api/buses')
@login_required
def api_buses():
    with db_conn() as con:
        rows=con.execute('''SELECT b.*,r.name route_name,u.full_name driver_name,l.lat,l.lng,l.speed,l.heading,l.accuracy,l.recorded_at,l.source FROM buses b LEFT JOIN routes r ON r.id=b.route_id LEFT JOIN users u ON u.id=b.driver_id LEFT JOIN locations l ON l.id=(SELECT id FROM locations WHERE bus_id=b.id ORDER BY recorded_at DESC,id DESC LIMIT 1) ORDER BY b.bus_no''').fetchall()
    result=[]; now=datetime.now(timezone.utc)
    for row in rows:
        d=dict(row); dt=None
        if d['recorded_at']:
            try: dt=datetime.fromisoformat(d['recorded_at'].replace('Z','+00:00'))
            except ValueError: pass
        age=(now-dt).total_seconds() if dt else None
        d['tracking_status']='LIVE GPS' if age is not None and age <= 90 and d['source']=='device' else ('DEMO GPS' if d['source']=='demo' and age is not None and age <= 90 else ('STALE' if age is not None else 'NOT CONNECTED'))
        d['age_seconds']=int(age) if age is not None else None
        result.append(d)
    return jsonify(result)

@app.post('/api/tracking/location')
def receive_location():
    # Device integration: use X-Tracking-Token configured on server; never accept browser input as trusted device by default.
    expected=os.environ.get('TRACKING_API_TOKEN','')
    provided=request.headers.get('X-Tracking-Token','')
    if not expected or not secrets.compare_digest(expected,provided): return jsonify({'error':'Tracking device authentication is not configured or invalid'}),401
    data=request.get_json(silent=True) or {}
    try:
        bus_id=int(data['bus_id']); lat=float(data['latitude']); lng=float(data['longitude'])
        if not (-90 <= lat <= 90 and -180 <= lng <= 180): raise ValueError()
        speed=float(data['speed']) if data.get('speed') is not None else None
        heading=float(data['heading']) if data.get('heading') is not None else None
        accuracy=float(data['accuracy']) if data.get('accuracy') is not None else None
    except (KeyError,ValueError,TypeError): return jsonify({'error':'Valid bus_id, latitude and longitude are required'}),400
    stamp=data.get('timestamp') or now_iso()
    try: dt=datetime.fromisoformat(stamp.replace('Z','+00:00'))
    except ValueError: return jsonify({'error':'Timestamp must be ISO-8601'}),400
    if (datetime.now(timezone.utc)-dt.astimezone(timezone.utc)).total_seconds()>300: return jsonify({'error':'GPS update is too old'}),400
    with db_conn() as con:
        if not con.execute('SELECT id FROM buses WHERE id=?',(bus_id,)).fetchone(): return jsonify({'error':'Unknown bus'}),404
        con.execute('INSERT INTO locations(bus_id,lat,lng,speed,heading,accuracy,device_id,source,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',(bus_id,lat,lng,speed,heading,accuracy,str(data.get('device_id',''))[:100],'device',dt.astimezone(timezone.utc).isoformat(timespec='seconds')))
    return jsonify({'ok':True})

@app.post('/api/driver/location')
@login_required
def driver_location():
    user=current_user()
    if user['role'] != 'DRIVER': return jsonify({'error':'Only a driver account can submit driver GPS'}),403
    if request.headers.get('X-CSRF-Token') != session.get('csrf'): return jsonify({'error':'Session token expired; reload page'}),403
    data=request.get_json(silent=True) or {}
    try:
        lat=float(data['latitude']); lng=float(data['longitude'])
        if not (-90 <= lat <= 90 and -180 <= lng <= 180): raise ValueError()
        speed=float(data['speed']) if data.get('speed') is not None else None
        heading=float(data['heading']) if data.get('heading') is not None else None
        accuracy=float(data['accuracy']) if data.get('accuracy') is not None else None
    except (KeyError,ValueError,TypeError): return jsonify({'error':'Valid latitude and longitude are required'}),400
    with db_conn() as con:
        bus=con.execute('SELECT id FROM buses WHERE driver_id=? AND status="Active" ORDER BY id LIMIT 1',(user['id'],)).fetchone()
        if not bus: return jsonify({'error':'No active bus is assigned to this driver account'}),409
        con.execute('INSERT INTO locations(bus_id,lat,lng,speed,heading,accuracy,device_id,source,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',(bus['id'],lat,lng,speed,heading,accuracy,'driver-browser','device',now_iso()))
    return jsonify({'ok':True,'message':'GPS update received'})

@app.get('/api/tracking/buses/<int:bus_id>/history')
@login_required
def location_history(bus_id):
    with db_conn() as con: rows=con.execute('SELECT lat,lng,speed,heading,accuracy,source,recorded_at FROM locations WHERE bus_id=? ORDER BY recorded_at DESC LIMIT 100',(bus_id,)).fetchall()
    return jsonify([dict(r) for r in rows])

@app.get('/api/students')
@roles_required('ADMIN')
def api_students():
    with db_conn() as con:
        rows=con.execute('SELECT s.name,s.register_no,s.department,s.academic_year,s.phone,b.bus_no,r.name route_name FROM students s LEFT JOIN buses b ON b.id=s.bus_id LEFT JOIN routes r ON r.id=s.route_id ORDER BY s.name LIMIT 5000').fetchall()
    return jsonify([dict(x) for x in rows])

@app.get('/api/routes')
@login_required
def api_routes():
    with db_conn() as con:
        routes=con.execute('SELECT r.*,COUNT(DISTINCT b.id) bus_count,COUNT(DISTINCT s.id) stop_count FROM routes r LEFT JOIN buses b ON b.route_id=r.id LEFT JOIN stops s ON s.route_id=r.id GROUP BY r.id ORDER BY r.route_code').fetchall()
        stops=con.execute('SELECT s.*,r.route_code FROM stops s JOIN routes r ON r.id=s.route_id ORDER BY r.route_code,s.sequence').fetchall()
    return jsonify({'routes':[dict(x) for x in routes],'stops':[dict(x) for x in stops]})

@app.post('/api/buses')
@roles_required('ADMIN')
def save_bus():
    if request.headers.get('X-CSRF-Token') != session.get('csrf'): return jsonify({'error':'Session token expired; reload page'}),403
    d=request.get_json(silent=True) or {}
    bus_no=str(d.get('bus_no','')).strip().upper()
    if not bus_no: return jsonify({'error':'Bus number is required'}),400
    try: capacity=max(1,min(100,int(d.get('capacity',40)))); route_id=int(d['route_id']) if d.get('route_id') else None
    except (ValueError,TypeError): return jsonify({'error':'Capacity or route is invalid'}),400
    status=d.get('status','Active')
    if status not in ['Active','Inactive','Maintenance','Out of service']: return jsonify({'error':'Invalid status'}),400
    with db_conn() as con:
        try:
            con.execute('INSERT INTO buses(bus_no,registration,capacity,model,status,route_id,created_at) VALUES(?,?,?,?,?,?,?)',(bus_no,str(d.get('registration',''))[:40],capacity,str(d.get('model',''))[:80],status,route_id,now_iso()))
        except sqlite3.IntegrityError: return jsonify({'error':'Bus number already exists or route is invalid'}),409
    audit('bus_created',bus_no); return jsonify({'ok':True})

@app.post('/api/routes')
@roles_required('ADMIN')
def save_route():
    if request.headers.get('X-CSRF-Token') != session.get('csrf'): return jsonify({'error':'Session token expired; reload page'}),403
    d=request.get_json(silent=True) or {}; code=str(d.get('route_code','')).strip().upper(); name=str(d.get('name','')).strip()
    if not code or not name: return jsonify({'error':'Route code and name are required'}),400
    with db_conn() as con:
        try: con.execute('INSERT INTO routes(route_code,name,origin,destination,notes) VALUES(?,?,?,?,?)',(code,name,str(d.get('origin',''))[:100],str(d.get('destination',''))[:100],str(d.get('notes',''))[:300]))
        except sqlite3.IntegrityError: return jsonify({'error':'Route code already exists'}),409
    audit('route_created',code); return jsonify({'ok':True})

@app.post('/api/alerts/<int:alert_id>/ack')
@roles_required('ADMIN')
def ack_alert(alert_id):
    with db_conn() as con: con.execute('UPDATE alerts SET status="Acknowledged",acknowledged_by=? WHERE id=? AND status="Open"',(session['uid'],alert_id))
    audit('alert_acknowledged',str(alert_id)); return jsonify({'ok':True})

@app.get('/api/alerts')
@login_required
def get_alerts():
    with db_conn() as con: rows=con.execute('SELECT a.*,b.bus_no FROM alerts a LEFT JOIN buses b ON b.id=a.bus_id ORDER BY CASE status WHEN "Open" THEN 0 ELSE 1 END,created_at DESC LIMIT 200').fetchall()
    return jsonify([dict(x) for x in rows])

@app.post('/api/import/<category>')
@roles_required('ADMIN')
def import_file(category):
    if request.headers.get('X-CSRF-Token') != session.get('csrf'): return jsonify({'error':'Session token expired; reload page'}),403
    if category not in ['buses','routes','students']: return jsonify({'error':'Unsupported import category'}),400
    f=request.files.get('file')
    if not f or not f.filename: return jsonify({'error':'Choose an .xlsx or .csv file'}),400
    filename=secure_filename(f.filename)
    if not (filename.lower().endswith('.csv') or filename.lower().endswith('.xlsx')): return jsonify({'error':'Only .csv and .xlsx files are accepted'}),400
    raw=f.read()
    try:
        if filename.lower().endswith('.csv'):
            text=raw.decode('utf-8-sig'); reader=csv.DictReader(io.StringIO(text)); records=list(reader)
        else:
            from openpyxl import load_workbook
            wb=load_workbook(io.BytesIO(raw),read_only=True,data_only=True)
            sheet_name={'buses':'Buses','routes':'Routes','students':'Students'}[category]
            ws=wb[sheet_name] if sheet_name in wb.sheetnames else wb.active
            vals=list(ws.iter_rows(values_only=True)); headers=[str(v).strip() if v is not None else '' for v in (vals[0] if vals else [])]
            records=[{headers[i]:row[i] for i in range(min(len(headers),len(row))) if headers[i]} for row in vals[1:] if any(v is not None for v in row)]
        if len(records)>10000: return jsonify({'error':'Maximum 10,000 rows per import'}),400
    except Exception: return jsonify({'error':'Could not read this file. Check the template and file format.'}),400
    def norm(d): return {str(k).strip().lower().replace(' ','_'):v for k,v in d.items() if k is not None}
    records=[norm(r) for r in records]; imported=skipped=failed=0; errors=[]
    with db_conn() as con:
        for idx,row in enumerate(records,start=2):
            try:
                if category=='buses':
                    no=str(row.get('bus_number') or row.get('bus_no') or '').strip().upper()
                    if not no: raise ValueError('Bus Number is required')
                    cap=int(row.get('bus_capacity') or row.get('capacity') or 40)
                    route_label=str(row.get('assigned_route') or row.get('route_code') or '').strip()
                    route=con.execute('SELECT id FROM routes WHERE route_code=? OR name=?',(route_label,route_label)).fetchone() if route_label else None
                    exists=con.execute('SELECT id FROM buses WHERE bus_no=?',(no,)).fetchone()
                    if exists: con.execute('UPDATE buses SET registration=?,capacity=?,model=? WHERE bus_no=?',(str(row.get('vehicle_registration_number') or row.get('registration') or '')[:40],cap,str(row.get('bus_model') or row.get('model') or '')[:80],no)); skipped+=1
                    else: con.execute('INSERT INTO buses(bus_no,registration,capacity,model,status,route_id,created_at) VALUES(?,?,?,?,?,?,?)',(no,str(row.get('vehicle_registration_number') or row.get('registration') or '')[:40],cap,str(row.get('bus_model') or row.get('model') or '')[:80],str(row.get('bus_status') or 'Active'),route['id'] if route else None,now_iso())); imported+=1
                elif category=='routes':
                    code=str(row.get('route_id') or row.get('route_code') or '').strip().upper(); name=str(row.get('route_name') or row.get('name') or '').strip()
                    if not code or not name: raise ValueError('Route ID and Route Name are required')
                    existing=con.execute('SELECT id FROM routes WHERE route_code=?',(code,)).fetchone()
                    if existing: con.execute('UPDATE routes SET name=?,origin=?,destination=? WHERE route_code=?',(name,str(row.get('starting_point') or '')[:100],str(row.get('destination') or '')[:100],code)); skipped+=1
                    else: con.execute('INSERT INTO routes(route_code,name,origin,destination,notes) VALUES(?,?,?,?,?)',(code,name,str(row.get('starting_point') or '')[:100],str(row.get('destination') or '')[:100],'Imported from Excel')); imported+=1
                else:
                    reg=str(row.get('register_number') or row.get('register_no') or '').strip(); name=str(row.get('student_name') or row.get('name') or '').strip()
                    if not reg or not name: raise ValueError('Register Number and Student Name are required')
                    route_label=str(row.get('assigned_route') or row.get('route_code') or '').strip(); bus_label=str(row.get('assigned_bus_number') or row.get('bus_number') or '').strip()
                    route=con.execute('SELECT id FROM routes WHERE route_code=? OR name=?',(route_label,route_label)).fetchone() if route_label else None
                    bus=con.execute('SELECT id,route_id FROM buses WHERE bus_no=?',(bus_label.upper(),)).fetchone() if bus_label else None
                    existing=con.execute('SELECT id FROM students WHERE register_no=?',(reg,)).fetchone()
                    vals=(name,str(row.get('department') or '')[:100],str(row.get('academic_year') or '')[:30],str(row.get('phone_number') or row.get('phone') or '')[:30],bus['id'] if bus else None,route['id'] if route else (bus['route_id'] if bus else None))
                    if existing: con.execute('UPDATE students SET name=?,department=?,academic_year=?,phone=?,bus_id=?,route_id=? WHERE register_no=?',(*vals,reg)); skipped+=1
                    else: con.execute('INSERT INTO students(name,department,academic_year,phone,bus_id,route_id,register_no) VALUES(?,?,?,?,?,?,?)', (vals[0],vals[1],vals[2],vals[3],vals[4],vals[5],reg)); imported+=1
            except Exception as e:
                failed+=1; errors.append({'row':idx,'error':str(e)[:180]})
        con.execute('INSERT INTO import_jobs(filename,category,imported,skipped,failed,created_at,summary) VALUES(?,?,?,?,?,?,?)',(filename,category,imported,skipped,failed,now_iso(),json.dumps(errors[:500])))
    audit('excel_import',f'{filename}: {imported} imported, {skipped} updated/existing, {failed} failed')
    return jsonify({'ok':True,'imported':imported,'updated_or_existing':skipped,'failed':failed,'errors':errors})

@app.get('/templates/<category>.csv')
@login_required
def templates_csv(category):
    headers={'buses':['Bus Number','Vehicle Registration Number','Bus Capacity','Bus Model','Bus Status','Assigned Route'],'routes':['Route ID','Route Name','Starting Point','Destination','Route Distance'],'students':['Student Name','Register Number','Department','Academic Year','Phone Number','Assigned Bus Number','Assigned Route','Assigned Bus Stop']}
    if category not in headers: return 'Not found',404
    output=io.StringIO(); writer=csv.writer(output); writer.writerow(headers[category])
    return send_file(io.BytesIO(output.getvalue().encode('utf-8-sig')),mimetype='text/csv',as_attachment=True,download_name=f'JOY-{category}-template.csv')

@app.get('/health')
def health(): return jsonify({'ok':True,'database':'sqlite','gps_ingestion':'configured' if os.environ.get('TRACKING_API_TOKEN') else 'not configured'})

ADMIN_RESOURCES={'students':('students',['register_no','name','department','academic_year','phone','bus_id','route_id','stop_id']),'buses':('buses',['bus_no','registration','capacity','model','status','route_id','driver_id']),'routes':('routes',['route_code','name','origin','destination','notes','active']),'stops':('stops',['route_id','name','sequence','lat','lng','eta','coord_status']),'trips':('trips',['bus_id','route_id','driver_id','planned_start','planned_end','status']),'attendance':('attendance',['student_id','bus_id','trip_id','boarding_time','status']),'maintenance':('maintenance',['bus_id','category','description','status','resolution']),'alerts':('alerts',['category','message','bus_id','status']),'notifications':('notifications',['audience','title','message'])}
@app.get('/api/admin/<resource>')
@roles_required('ADMIN')
def admin_records(resource):
    if resource=='drivers':
        with db_conn() as con: rows=con.execute("SELECT id,username,full_name,active,created_at FROM users WHERE role='DRIVER' ORDER BY full_name").fetchall()
    elif resource=='permissions': rows=[{'role':'ADMIN','access':'All admin modules; admin-only protected actions'},{'role':'DRIVER','access':'Assigned bus GPS, routes, trip actions and alerts'},{'role':'STUDENT','access':'Read-only bus tracking and route information'}]
    elif resource=='settings':
        with db_conn() as con: rows=con.execute('SELECT * FROM system_settings ORDER BY key').fetchall()
    elif resource=='logs':
        with db_conn() as con: rows=con.execute('SELECT a.id,u.username,a.action,a.details,a.created_at FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').fetchall()
    elif resource in ADMIN_RESOURCES:
        table,fields=ADMIN_RESOURCES[resource]
        with db_conn() as con:
            if resource=='students': rows=con.execute('SELECT s.*,b.bus_no,r.name route_name FROM students s LEFT JOIN buses b ON b.id=s.bus_id LEFT JOIN routes r ON r.id=s.route_id ORDER BY s.name').fetchall()
            elif resource=='trips': rows=con.execute('SELECT t.*,b.bus_no,r.name route_name,u.full_name driver_name FROM trips t LEFT JOIN buses b ON b.id=t.bus_id LEFT JOIN routes r ON r.id=t.route_id LEFT JOIN users u ON u.id=t.driver_id ORDER BY t.id DESC').fetchall()
            elif resource=='attendance': rows=con.execute('SELECT a.*,s.name student_name,s.register_no,b.bus_no FROM attendance a JOIN students s ON s.id=a.student_id LEFT JOIN buses b ON b.id=a.bus_id ORDER BY a.id DESC').fetchall()
            elif resource=='maintenance': rows=con.execute('SELECT m.*,b.bus_no FROM maintenance m JOIN buses b ON b.id=m.bus_id ORDER BY m.id DESC').fetchall()
            elif resource=='stops': rows=con.execute('SELECT s.*,r.route_code FROM stops s JOIN routes r ON r.id=s.route_id ORDER BY r.route_code,s.sequence').fetchall()
            else: rows=con.execute('SELECT * FROM '+table+' ORDER BY id DESC LIMIT 1000').fetchall()
    else: return jsonify({'error':'Unknown admin module'}),404
    return jsonify([dict(x) for x in rows])
@app.post('/api/admin/<resource>')
@roles_required('ADMIN')
def admin_create_record(resource):
    if request.headers.get('X-CSRF-Token')!=session.get('csrf'): return jsonify({'error':'Session expired; reload the page'}),403
    d=request.get_json(silent=True) or {}
    if resource=='settings':
        key=str(d.get('key','')).strip();value=str(d.get('value',''))
        if not key:return jsonify({'error':'Setting key is required'}),400
        with db_conn() as con:con.execute('INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',(key,value,now_iso()))
        audit('setting_saved',key);return jsonify({'ok':True})
    if resource=='drivers':
        username=str(d.get('username','')).strip().lower(); name=str(d.get('full_name','')).strip(); password=str(d.get('password',''))
        if not username or not name or len(password)<8:return jsonify({'error':'Username, full name and password (8+ chars) are required'}),400
        try:
            with db_conn() as con: con.execute("INSERT INTO users(username,password_hash,role,full_name,created_at) VALUES(?,?,?,?,?)",(username,generate_password_hash(password),'DRIVER',name,now_iso()))
        except sqlite3.IntegrityError:return jsonify({'error':'Username already exists'}),409
        audit('driver_created',username);return jsonify({'ok':True})
    if resource=='students' and d.get('password'):
        username=str(d.get('username') or d.get('register_no') or '').strip().lower()
        if len(str(d['password']))<8:return jsonify({'error':'Student password must be at least 8 characters'}),400
        try:
            with db_conn() as con: con.execute("INSERT INTO users(username,password_hash,role,full_name,created_at) VALUES(?,?,?,?,?)",(username,generate_password_hash(str(d['password'])),'STUDENT',str(d.get('name',''))[:120],now_iso()))
        except sqlite3.IntegrityError:return jsonify({'error':'Student login username already exists'}),409
    if resource not in ADMIN_RESOURCES:return jsonify({'error':'This module cannot create records'}),400
    table,allowed=ADMIN_RESOURCES[resource];data={k:d[k] for k in allowed if k in d and d[k] not in ('',None)}
    required={'students':['register_no','name'],'buses':['bus_no'],'routes':['route_code','name'],'stops':['route_id','name'],'trips':['bus_id'],'attendance':['student_id','boarding_time'],'maintenance':['bus_id','category','description'],'alerts':['category','message'],'notifications':['title','message']}[resource]
    if any(not data.get(k) for k in required):return jsonify({'error':'Required fields: '+', '.join(required)}),400
    if resource=='trips':
        with db_conn() as con:
            if con.execute("SELECT id FROM trips WHERE bus_id=? AND status IN ('Scheduled','In progress','Active')",(data['bus_id'],)).fetchone():return jsonify({'error':'This bus already has a scheduled or active trip'}),409
            if data.get('driver_id') and con.execute("SELECT id FROM trips WHERE driver_id=? AND status IN ('Scheduled','In progress','Active')",(data['driver_id'],)).fetchone():return jsonify({'error':'This driver already has a scheduled or active trip'}),409
        data['status']='Scheduled'
    if resource=='maintenance':data.update(reported_at=now_iso(),status=data.get('status','Open'))
    if resource=='alerts':data.update(created_at=now_iso(),status=data.get('status','Open'))
    if resource=='notifications':data.update(created_at=now_iso(),created_by=session['uid'],audience=data.get('audience','ALL'))
    try:
        with db_conn() as con:
            cols=list(data);con.execute('INSERT INTO '+table+'('+','.join(cols)+') VALUES('+','.join(['?']*len(cols))+')',[data[k] for k in cols])
    except sqlite3.IntegrityError as e:return jsonify({'error':'Record conflicts with an existing or linked record: '+str(e)}),409
    audit(resource+'_created',str(data)[:400]);return jsonify({'ok':True})
@app.patch('/api/admin/<resource>/<int:rid>')
@roles_required('ADMIN')
def admin_update_record(resource,rid):
    if request.headers.get('X-CSRF-Token')!=session.get('csrf'):return jsonify({'error':'Session expired; reload the page'}),403
    d=request.get_json(silent=True) or {}
    if resource=='drivers':
        name=str(d.get('full_name','')).strip();active=0 if str(d.get('active','1')).lower() in ('0','false','inactive') else 1
        if not name:return jsonify({'error':'Full name is required'}),400
        with db_conn() as con:con.execute("UPDATE users SET full_name=?,active=? WHERE id=? AND role='DRIVER'",(name,active,rid))
    elif resource=='settings':
        key=str(d.get('key','')).strip();value=str(d.get('value',''))
        if not key:return jsonify({'error':'Setting key is required'}),400
        with db_conn() as con:con.execute('INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',(key,value,now_iso()))
    elif resource in ADMIN_RESOURCES:
        table,allowed=ADMIN_RESOURCES[resource];data={k:d[k] for k in allowed if k in d}
        if not data:return jsonify({'error':'No editable fields supplied'}),400
        if resource=='trips':
            with db_conn() as con:
                old=con.execute('SELECT status FROM trips WHERE id=?',(rid,)).fetchone()
                if not old:return jsonify({'error':'Trip not found'}),404
                if data.get('status')=='In progress' and old['status'] not in ('Scheduled','In progress'):return jsonify({'error':'Only scheduled trips can start'}),409
                if data.get('status')=='In progress':data['actual_start']=now_iso()
                if data.get('status')=='Completed':data['actual_end']=now_iso()
        if resource=='maintenance' and data.get('status')=='Resolved':data.update(resolved_at=now_iso())
        with db_conn() as con:con.execute('UPDATE '+table+' SET '+','.join(k+'=?' for k in data)+' WHERE id=?',list(data.values())+[rid])
    else:return jsonify({'error':'This module cannot be edited'}),400
    audit(resource+'_updated',str(rid));return jsonify({'ok':True})
@app.delete('/api/admin/<resource>/<int:rid>')
@roles_required('ADMIN')
def admin_delete_record(resource,rid):
    if request.headers.get('X-CSRF-Token')!=session.get('csrf'):return jsonify({'error':'Session expired; reload the page'}),403
    if resource not in ADMIN_RESOURCES or resource=='attendance':return jsonify({'error':'This record cannot be deleted from this module'}),400
    table=ADMIN_RESOURCES[resource][0]
    if resource=='trips':
        with db_conn() as con:
            t=con.execute('SELECT status FROM trips WHERE id=?',(rid,)).fetchone()
            if t and t['status'] in ('In progress','Active'):return jsonify({'error':'Complete active trips before deleting'}),409
    with db_conn() as con:
        cur=con.execute('DELETE FROM '+table+' WHERE id=?',(rid,))
        if cur.rowcount==0:return jsonify({'error':'Record not found'}),404
    audit(resource+'_deleted',str(rid));return jsonify({'ok':True})
@app.get('/api/admin/reports')
@roles_required('ADMIN')
def admin_report_counts():
    with db_conn() as con:
        return jsonify({k:con.execute(q).fetchone()[0] for k,q in {'students':'SELECT COUNT(*) FROM students','drivers':"SELECT COUNT(*) FROM users WHERE role='DRIVER' AND active=1",'buses':'SELECT COUNT(*) FROM buses','routes':'SELECT COUNT(*) FROM routes','active_trips':"SELECT COUNT(*) FROM trips WHERE status IN ('Active','In progress')",'attendance':'SELECT COUNT(*) FROM attendance','maintenance_open':"SELECT COUNT(*) FROM maintenance WHERE status!='Resolved'",'open_alerts':"SELECT COUNT(*) FROM alerts WHERE status='Open'"}.items()})


if __name__=='__main__':
    print('JOY UNIVERSITY BUS TRACKING — development server')
    print('Open http://127.0.0.1:5000 | Demo credentials are listed in README.md')
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT','5000')), debug=False)
