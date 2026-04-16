from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    specialization = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)

    def to_dict(self):
        return {
            'id': self.id, 'email': self.email, 'name': self.name,
            'role': self.role, 'specialization': self.specialization
        }

class Appointment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    doctor_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    date = db.Column(db.DateTime, nullable=False)
    reason = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')
    doctor_notes = db.Column(db.Text)
    suggested_test = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    patient = db.relationship('User', foreign_keys=[patient_id])
    doctor = db.relationship('User', foreign_keys=[doctor_id])

    def to_dict(self):
        return {
            'id': self.id, 'patient_id': self.patient_id,
            'doctor_id': self.doctor_id, 'date': self.date.isoformat(),
            'reason': self.reason, 'status': self.status,
            'doctor_notes': self.doctor_notes,
            'suggested_test': self.suggested_test,
            'patient_name': self.patient.name if self.patient else None,
            'doctor_name': self.doctor.name if self.doctor else None
        }

class TestRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    doctor_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    pathologist_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    appointment_id = db.Column(db.Integer, db.ForeignKey('appointment.id'))
    test_name = db.Column(db.String(200), nullable=False)
    status = db.Column(db.String(20), default='requested')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    patient = db.relationship('User', foreign_keys=[patient_id])
    doctor = db.relationship('User', foreign_keys=[doctor_id])

    def to_dict(self):
        return {
            'id': self.id, 'patient_id': self.patient_id,
            'doctor_id': self.doctor_id, 'test_name': self.test_name,
            'status': self.status, 'appointment_id': self.appointment_id,
            'patient_name': self.patient.name if self.patient else None,
            'doctor_name': self.doctor.name if self.doctor else None
        }

class DicomReport(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    test_request_id = db.Column(db.Integer, db.ForeignKey('test_request.id'))
    patient_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    uploaded_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    filename = db.Column(db.String(300), nullable=False)
    filepath = db.Column(db.String(500), nullable=False)
    findings = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    patient = db.relationship('User', foreign_keys=[patient_id])
    uploader = db.relationship('User', foreign_keys=[uploaded_by])
    test_request = db.relationship('TestRequest')

    def to_dict(self):
        return {
            'id': self.id, 'test_request_id': self.test_request_id,
            'patient_id': self.patient_id, 'filename': self.filename,
            'findings': self.findings, 'created_at': self.created_at.isoformat(),
            'patient_name': self.patient.name if self.patient else None,
            'uploader_name': self.uploader.name if self.uploader else None
        }