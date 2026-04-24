import os
import io
import time
import json
import traceback
import numpy as np
import pydicom
from pydicom.pixel_data_handlers.util import apply_modality_lut, apply_voi_lut
import cloudinary
import cloudinary.uploader
import requests
from PIL import Image
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from models import db, User, Appointment, TestRequest, DicomReport
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()
app = Flask(__name__)

# Strip whitespace from env vars to avoid common config errors
CLOUD_NAME = os.getenv("CLOUD_NAME", "").strip()
API_KEY = os.getenv("API_KEY", "").strip()
API_SECRET = os.getenv("API_SECRET", "").strip()

if CLOUD_NAME and API_KEY and API_SECRET:
    cloudinary.config(
        cloud_name=CLOUD_NAME,
        api_key=API_KEY,
        api_secret=API_SECRET
    )
else:
    print("WARNING: Cloudinary not fully configured. Falling back to local storage.")

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///telemedicine.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = 'super-secret-key-change-this'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')

# Simple in-memory cache for processed DICOM images
# Stores: report_id -> { "content": bytes, "timestamp": float }
dicom_cache = {}
CACHE_LIMIT = 50 # Max images to keep in memory

CORS(app, resources={r"/api/*": {"origins": "*"}})
JWTManager(app)
db.init_app(app)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# ─── AI SYMPTOM CHECKER ────────────────────────────────────
SYMPTOM_DB = {
    "headache": {"suggestions": ["Rest in dark room", "Stay hydrated", "Take OTC pain relief"], "tests": ["CT Scan", "MRI Brain"], "specialist": "Neurologist", "urgency": "low"},
    "chest pain": {"suggestions": ["Seek immediate medical help", "Chew aspirin if available", "Rest and stay calm"], "tests": ["ECG", "Chest X-Ray", "Cardiac Enzymes"], "specialist": "Cardiologist", "urgency": "high"},
    "fever": {"suggestions": ["Rest and hydrate", "Take acetaminophen", "Monitor temperature"], "tests": ["CBC", "Blood Culture"], "specialist": "General Physician", "urgency": "medium"},
    "cough": {"suggestions": ["Warm fluids", "Honey and ginger", "Steam inhalation"], "tests": ["Chest X-Ray", "Sputum Test"], "specialist": "Pulmonologist", "urgency": "low"},
    "back pain": {"suggestions": ["Gentle stretching", "Hot/cold compress", "Maintain posture"], "tests": ["X-Ray Spine", "MRI Spine"], "specialist": "Orthopedic", "urgency": "low"},
    "stomach pain": {"suggestions": ["Avoid spicy food", "Take antacids", "Stay hydrated"], "tests": ["Ultrasound Abdomen", "Endoscopy"], "specialist": "Gastroenterologist", "urgency": "medium"},
    "breathing difficulty": {"suggestions": ["Sit upright", "Use inhaler if prescribed", "Seek emergency care"], "tests": ["Chest X-Ray", "Pulmonary Function Test", "CT Chest"], "specialist": "Pulmonologist", "urgency": "high"},
    "joint pain": {"suggestions": ["Rest the joint", "Apply ice", "OTC anti-inflammatory"], "tests": ["X-Ray", "MRI", "Rheumatoid Factor"], "specialist": "Rheumatologist", "urgency": "low"},
    "dizziness": {"suggestions": ["Sit or lie down", "Drink water", "Avoid sudden movements"], "tests": ["MRI Brain", "Blood Pressure Check", "Blood Sugar Test"], "specialist": "Neurologist", "urgency": "medium"},
    "skin rash": {"suggestions": ["Avoid scratching", "Apply calamine lotion", "Use antihistamines"], "tests": ["Skin Biopsy", "Allergy Test"], "specialist": "Dermatologist", "urgency": "low"},
}

def ai_analyze(symptoms_text):
    symptoms_text = symptoms_text.lower()
    results = []
    for key, data in SYMPTOM_DB.items():
        if key in symptoms_text:
            results.append({"symptom": key, **data})
    if not results:
        return {
            "message": "I couldn't identify specific symptoms. Please consult a General Physician.",
            "suggestions": ["Book an appointment with a doctor", "Describe symptoms in detail"],
            "tests": ["General Health Checkup"], "specialist": "General Physician", "urgency": "low"
        }
    urgency_order = {"high": 3, "medium": 2, "low": 1}
    results.sort(key=lambda x: urgency_order.get(x["urgency"], 0), reverse=True)
    all_suggestions, all_tests, specialists = [], [], []
    for r in results:
        all_suggestions.extend(r["suggestions"])
        all_tests.extend(r["tests"])
        specialists.append(r["specialist"])
    return {
        "matched_symptoms": [r["symptom"] for r in results],
        "urgency": results[0]["urgency"],
        "suggestions": list(dict.fromkeys(all_suggestions)),
        "recommended_tests": list(dict.fromkeys(all_tests)),
        "specialists": list(dict.fromkeys(specialists)),
        "message": f"Based on your symptoms, urgency level is: {results[0]['urgency'].upper()}"
    }

# ─── AUTH ROUTES ────────────────────────────────────────────
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.json
    if User.query.filter_by(email=data['email']).first():
        return jsonify(error='Email exists'), 409
    u = User(email=data['email'], name=data['name'], role=data['role'],
             specialization=data.get('specialization'))
    u.set_password(data['password'])
    db.session.add(u)
    db.session.commit()
    token = create_access_token(identity=str(u.id))
    return jsonify(token=token, user=u.to_dict()), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    u = User.query.filter_by(email=data['email']).first()
    if not u or not u.check_password(data['password']):
        return jsonify(error='Invalid credentials'), 401
    token = create_access_token(identity=str(u.id))
    return jsonify(token=token, user=u.to_dict())

@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def me():
    u = User.query.get(int(get_jwt_identity()))
    return jsonify(user=u.to_dict())

@app.route('/api/doctors', methods=['GET'])
@jwt_required()
def get_doctors():
    docs = User.query.filter_by(role='doctor').all()
    return jsonify(doctors=[d.to_dict() for d in docs])

@app.route('/api/pathologists', methods=['GET'])
@jwt_required()
def get_pathologists():
    paths = User.query.filter_by(role='pathologist').all()
    return jsonify(pathologists=[p.to_dict() for p in paths])

# ─── APPOINTMENT ROUTES ────────────────────────────────────
@app.route('/api/appointments', methods=['POST'])
@jwt_required()
def create_appointment():
    uid = int(get_jwt_identity())
    data = request.json
    apt = Appointment(
        patient_id=uid, doctor_id=data['doctor_id'],
        date=datetime.fromisoformat(data['date']),
        reason=data.get('reason', '')
    )
    db.session.add(apt)
    db.session.commit()
    return jsonify(appointment=apt.to_dict()), 201

@app.route('/api/appointments', methods=['GET'])
@jwt_required()
def get_appointments():
    uid = int(get_jwt_identity())
    u = User.query.get(uid)
    if u.role == 'patient':
        apts = Appointment.query.filter_by(patient_id=uid).order_by(Appointment.date.desc()).all()
    else:
        apts = Appointment.query.filter_by(doctor_id=uid).order_by(Appointment.date.desc()).all()
    return jsonify(appointments=[a.to_dict() for a in apts])

@app.route('/api/appointments/<int:aid>/respond', methods=['PATCH'])
@jwt_required()
def respond_appointment(aid):
    data = request.json
    apt = Appointment.query.get_or_404(aid)
    apt.status = data['status']
    if data.get('notes'):
        apt.doctor_notes = data['notes']
    if data.get('suggested_test'):
        apt.suggested_test = data['suggested_test']
    db.session.commit()
    return jsonify(appointment=apt.to_dict())

# ─── TEST REQUEST ROUTES ───────────────────────────────────
@app.route('/api/test-requests', methods=['POST'])
@jwt_required()
def create_test_request():
    uid = int(get_jwt_identity())
    data = request.json
    tr = TestRequest(
        patient_id=uid, doctor_id=data['doctor_id'],
        pathologist_id=data.get('pathologist_id'),
        appointment_id=data.get('appointment_id'),
        test_name=data['test_name']
    )
    db.session.add(tr)
    db.session.commit()
    return jsonify(test_request=tr.to_dict()), 201

@app.route('/api/test-requests', methods=['GET'])
@jwt_required()
def get_test_requests():
    uid = int(get_jwt_identity())
    u = User.query.get(uid)
    if u.role == 'patient':
        trs = TestRequest.query.filter_by(patient_id=uid).all()
    elif u.role == 'doctor':
        trs = TestRequest.query.filter_by(doctor_id=uid).all()
    else:
        trs = TestRequest.query.filter(
            (TestRequest.pathologist_id == uid) | (TestRequest.pathologist_id == None)
        ).all()
    return jsonify(test_requests=[t.to_dict() for t in trs])

@app.route('/api/test-requests/<int:tid>/accept', methods=['PATCH'])
@jwt_required()
def accept_test_request(tid):
    uid = int(get_jwt_identity())
    tr = TestRequest.query.get_or_404(tid)
    tr.pathologist_id = uid
    tr.status = 'accepted'
    db.session.commit()
    return jsonify(test_request=tr.to_dict())

# ─── DICOM ROUTES ─────────────────────────────────────────
@app.route('/api/dicom/upload', methods=['POST'])
@jwt_required()
def upload_dicom():
    uid = int(get_jwt_identity())
    if 'file' not in request.files:
        return jsonify(error='No file'), 400

    f = request.files['file']
    if not f.filename.lower().endswith('.dcm'):
        return jsonify(error='Only .dcm DICOM files allowed'), 400

    test_request_id = request.form.get('test_request_id')
    patient_id = request.form.get('patient_id')
    findings = request.form.get('findings', '')

    fname = f"{int(time.time())}_{f.filename}"
    file_url = ""

    # Try Cloudinary first
    if CLOUD_NAME and API_KEY and API_SECRET:
        try:
            f.seek(0)
            upload_result = cloudinary.uploader.upload(f, resource_type="raw")
            file_url = upload_result["secure_url"]
            print(f"Uploaded to Cloudinary: {file_url}")
        except Exception as e:
            print(f"Cloudinary upload failed: {e}. Falling back to local storage.")

    # Local fallback if Cloudinary failed or not configured
    if not file_url:
        f.seek(0)
        local_path = os.path.join(app.config['UPLOAD_FOLDER'], fname)
        f.save(local_path)
        # We store the local absolute path or just the filename with a prefix
        file_url = f"local://{fname}"
        print(f"Saved locally: {local_path}")

    report = DicomReport(
        test_request_id=int(test_request_id) if test_request_id else None,
        patient_id=int(patient_id),
        uploaded_by=uid,
        filename=fname,
        filepath=file_url,
        findings=findings
    )
    db.session.add(report)

    if test_request_id:
        tr = TestRequest.query.get(int(test_request_id))
        if tr:
            tr.status = 'completed'

    db.session.commit()
    return jsonify(report=report.to_dict()), 201


@app.route('/api/dicom/reports', methods=['GET'])
@jwt_required()
def get_reports():
    uid = int(get_jwt_identity())
    u = User.query.get(uid)

    if u.role == 'patient':
        reports = DicomReport.query.filter_by(patient_id=uid).all()
    elif u.role == 'pathologist':
        reports = DicomReport.query.filter_by(uploaded_by=uid).all()
    else:
        patient_ids = [a.patient_id for a in Appointment.query.filter_by(doctor_id=uid).all()]
        reports = DicomReport.query.filter(DicomReport.patient_id.in_(patient_ids)).all()

    return jsonify(reports=[r.to_dict() for r in reports])


@app.route('/api/dicom/view/<int:rid>')
@jwt_required()
def view_dicom(rid):
    # ⚡ Check Cache First
    if rid in dicom_cache:
        print(f"⚡ Serving DICOM {rid} from Cache")
        return send_file(io.BytesIO(dicom_cache[rid]['content']), mimetype='image/png')

    try:
        report = DicomReport.query.get_or_404(rid)

        # ✅ fetch DICOM from Cloudinary or Local
        if report.filepath.startswith('local://'):
            fname = report.filepath.replace('local://', '')
            lpath = os.path.join(app.config['UPLOAD_FOLDER'], fname)
            if not os.path.exists(lpath):
                return jsonify(error="Local file not found"), 404
            with open(lpath, 'rb') as lf:
                content = lf.read()
        else:
            response = requests.get(report.filepath, timeout=30)
            if response.status_code != 200:
                return jsonify(error="Failed to fetch DICOM file from storage"), 500
            content = response.content

        ds = pydicom.dcmread(io.BytesIO(content), force=True)

        # Check for pixel data safely (do NOT use hasattr(ds, 'pixel_array')
        # because that triggers decompression which can crash)
        if 'PixelData' not in ds:
            return jsonify(error="No pixel data in DICOM file"), 400

        # Handle compressed transfer syntaxes
        try:
            ds.decompress()
        except Exception:
            pass  # Already uncompressed or handler not available

        try:
            pixel_array = ds.pixel_array.astype(float)
        except Exception as px_err:
            return jsonify(error=f"Cannot decode pixel data: {str(px_err)}"), 400

        # For multi-frame DICOM, take the first frame
        if pixel_array.ndim == 4:
            pixel_array = pixel_array[0]
        elif pixel_array.ndim == 3 and pixel_array.shape[0] > 4:
            # Likely multi-frame grayscale (frames, rows, cols)
            pixel_array = pixel_array[0]

        if pixel_array.max() == pixel_array.min():
            return jsonify(error="Image has no contrast (blank)"), 400

        # Apply DICOM modality and VOI LUT for proper windowing
        try:
            pixel_array = apply_modality_lut(pixel_array, ds)
        except Exception:
            pass
        try:
            pixel_array = apply_voi_lut(pixel_array.astype(float), ds)
        except Exception:
            pass

        # Normalize to 0-255
        pmin, pmax = pixel_array.min(), pixel_array.max()
        if pmax != pmin:
            pixel_array = (pixel_array - pmin) / (pmax - pmin) * 255.0
        pixel_array = pixel_array.astype(np.uint8)

        # Convert to PIL Image
        if pixel_array.ndim == 2:
            img = Image.fromarray(pixel_array, mode='L')
        elif pixel_array.ndim == 3 and pixel_array.shape[2] == 3:
            img = Image.fromarray(pixel_array, mode='RGB')
        elif pixel_array.ndim == 3 and pixel_array.shape[2] == 4:
            img = Image.fromarray(pixel_array, mode='RGBA')
        else:
            return jsonify(error="Unsupported image dimensions"), 400

        img_io = io.BytesIO()
        img.save(img_io, format='PNG')
        img_io.seek(0)
        png_content = img_io.read()

        # ⚡ Store in Cache
        if len(dicom_cache) >= CACHE_LIMIT:
            # Remove oldest entry if limit reached
            oldest_rid = min(dicom_cache.keys(), key=lambda k: dicom_cache[k]['timestamp'])
            del dicom_cache[oldest_rid]
        
        dicom_cache[rid] = {
            'content': png_content,
            'timestamp': time.time()
        }

        return send_file(io.BytesIO(png_content), mimetype='image/png')

    except Exception as e:
        traceback.print_exc()
        return jsonify(error=f"Cannot render DICOM: {str(e)}"), 500

@app.route('/api/dicom/metadata/<int:rid>', methods=['GET'])
@jwt_required()
def dicom_metadata(rid):
    try:
        report = DicomReport.query.get_or_404(rid)

        # ✅ fetch DICOM from Cloudinary or Local
        if report.filepath.startswith('local://'):
            fname = report.filepath.replace('local://', '')
            lpath = os.path.join(app.config['UPLOAD_FOLDER'], fname)
            if not os.path.exists(lpath):
                return jsonify(error="Local file not found"), 404
            with open(lpath, 'rb') as lf:
                content = lf.read()
        else:
            response = requests.get(report.filepath, timeout=30)
            if response.status_code != 200:
                return jsonify(error="Failed to fetch DICOM"), 500
            content = response.content

        # force=True allows reading even slightly malformed files
        # Metadata does NOT require pixel data so no pixel_array check
        ds = pydicom.dcmread(io.BytesIO(content), force=True)

        meta = {
            'PatientName':      str(getattr(ds, 'PatientName', 'N/A')),
            'PatientID':        str(getattr(ds, 'PatientID', 'N/A')),
            'Modality':         str(getattr(ds, 'Modality', 'N/A')),
            'StudyDate':        str(getattr(ds, 'StudyDate', 'N/A')),
            'StudyDescription': str(getattr(ds, 'StudyDescription', 'N/A')),
            'BodyPartExamined': str(getattr(ds, 'BodyPartExamined', 'N/A')),
            'Rows':             int(getattr(ds, 'Rows', 0)),
            'Columns':          int(getattr(ds, 'Columns', 0)),
            'BitsAllocated':    int(getattr(ds, 'BitsAllocated', 0)),
            'TransferSyntax':   str(getattr(ds.file_meta, 'TransferSyntaxUID', 'N/A')) if hasattr(ds, 'file_meta') else 'N/A',
            'findings':         report.findings
        }

        return jsonify(metadata=meta)

    except Exception as e:
        traceback.print_exc()
        return jsonify(error=str(e)), 500

# ─── AI ENDPOINT ───────────────────────────────────────────
@app.route('/api/ai/analyze', methods=['POST'])
@jwt_required()
def analyze_symptoms():
    data = request.json
    result = ai_analyze(data.get('symptoms', ''))
    return jsonify(result=result)

@app.route("/")
def home():
    return "Telemedicine Backend Running"

# ─── SEED & RUN ────────────────────────────────────────────
def seed():
    if User.query.count() == 0:
        users = [
            ('patient@test.com',  'Patient User',    'patient',     None),
            ('patient2@test.com', 'Patient2 User',   'patient',     None),
            ('doctor@test.com',   'Dr. Smith',        'doctor',      'General Medicine'),
            ('cardio@test.com',   'Dr. Heart',        'doctor',      'Cardiology'),
            ('neuro@test.com',    'Dr. Brain',        'doctor',      'Neurology'),
            ('path@test.com',     'Lab Tech Alice',   'pathologist', 'Radiology'),
            ('path2@test.com',    'Lab Tech Bob',     'pathologist', 'Pathology'),
        ]
        for email, name, role, spec in users:
            u = User(email=email, name=name, role=role, specialization=spec)
            u.set_password('123456')
            db.session.add(u)
        db.session.commit()
        print("Seeded!")

with app.app_context():
    db.create_all()
    seed()

if __name__ == '__main__':
    app.run(host='127.0.0.1', debug=True, port=7000)