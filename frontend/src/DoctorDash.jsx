import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import api from './api';
import DicomViewer from './DicomViewer';

export default function DoctorDash() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('appointments');
  const [appointments, setAppointments] = useState([]);
  const [testRequests, setTestRequests] = useState([]);
  const [reports, setReports] = useState([]);
  const [viewReport, setViewReport] = useState(null);
  const [respondForm, setRespondForm] = useState({});

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [a,t,r] = await Promise.all([
      api.get('/appointments'), api.get('/test-requests'), api.get('/dicom/reports')
    ]);
    setAppointments(a.data.appointments);
    setTestRequests(t.data.test_requests);
    setReports(r.data.reports);
  };

  const respond = async (id, status) => {
    const data = { status, notes: respondForm[id]?.notes||'', suggested_test: respondForm[id]?.test||'' };
    await api.patch(`/appointments/${id}/respond`, data);
    setRespondForm(f => { const n={...f}; delete n[id]; return n; });
    loadAll();
  };

  const statusBadge = s => <span className={`badge-${s}`}>{s}</span>;

  const tabs = [
    { id:'appointments', label:'📋 Appointments' },
    { id:'tests', label:'🧪 Tests' },
    { id:'reports', label:'🔬 DICOM Reports' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2"><span className="text-xl">🏥</span><span className="font-bold text-lg text-blue-600">MediConnect</span><span className="badge bg-emerald-100 text-emerald-700">Doctor</span></div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">🩺 {user.name}</span>
            <button onClick={logout} className="text-sm text-red-500 hover:text-red-700">Logout</button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex gap-1 mb-6">
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>{setTab(t.id);setViewReport(null);}}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab===t.id?'bg-blue-600 text-white shadow':'bg-white text-gray-600 hover:bg-gray-100'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* APPOINTMENTS */}
        {tab==='appointments' && (
          <div className="fade-in space-y-3">
            <h2 className="text-2xl font-bold mb-2">Patient Appointments</h2>
            {appointments.map(a=>(
              <div key={a.id} className="card">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-lg">{a.patient_name}</div>
                    <div className="text-sm text-gray-500">{new Date(a.date).toLocaleString()}</div>
                    {a.reason && <div className="text-sm mt-1">📝 {a.reason}</div>}
                  </div>
                  {statusBadge(a.status)}
                </div>

                {a.status==='pending' && (
                  <div className="border-t pt-3 space-y-2">
                    <input className="input" placeholder="Notes for patient..."
                      value={respondForm[a.id]?.notes||''}
                      onChange={e=>setRespondForm({...respondForm,[a.id]:{...respondForm[a.id],notes:e.target.value}})}/>
                    <input className="input" placeholder="Suggest a test (e.g. MRI Brain)..."
                      value={respondForm[a.id]?.test||''}
                      onChange={e=>setRespondForm({...respondForm,[a.id]:{...respondForm[a.id],test:e.target.value}})}/>
                    <div className="flex gap-2">
                      <button onClick={()=>respond(a.id,'accepted')} className="btn-green flex-1">✓ Accept</button>
                      <button onClick={()=>respond(a.id,'rejected')} className="btn-red flex-1">✗ Reject</button>
                    </div>
                  </div>
                )}

                {a.status!=='pending' && a.doctor_notes && (
                  <div className="border-t pt-2 mt-2 text-sm text-gray-600">Notes: {a.doctor_notes}</div>
                )}
                {a.status!=='pending' && a.suggested_test && (
                  <div className="text-sm text-purple-600">🧪 Suggested: {a.suggested_test}</div>
                )}
              </div>
            ))}
            {appointments.length===0 && <div className="card text-center text-gray-400">No appointments</div>}
          </div>
        )}

        {/* TESTS */}
        {tab==='tests' && (
          <div className="fade-in space-y-3">
            <h2 className="text-2xl font-bold mb-2">Test Requests</h2>
            {testRequests.map(t=>(
              <div key={t.id} className="card flex items-center justify-between">
                <div>
                  <div className="font-medium">{t.test_name}</div>
                  <div className="text-xs text-gray-500">Patient: {t.patient_name} | ID: P-{t.patient_id}</div>
                </div>
                {statusBadge(t.status)}
              </div>
            ))}
            {testRequests.length===0 && <div className="card text-center text-gray-400">No test requests</div>}
          </div>
        )}

        {/* REPORTS */}
        {tab==='reports' && (
          <div className="fade-in">
            <h2 className="text-2xl font-bold mb-4">🔬 Patient DICOM Reports</h2>
            {viewReport ? (
              <div>
                <button onClick={()=>setViewReport(null)} className="btn-gray mb-4">← Back</button>
                <DicomViewer reportId={viewReport.id} findings={viewReport.findings}/>
              </div>
            ) : (
              <div className="space-y-3">
                {reports.map(r=>(
                  <div key={r.id} className="card flex items-center justify-between">
                    <div>
                      <div className="font-medium">Patient: {r.patient_name} (P-{r.patient_id})</div>
                      <div className="text-xs text-gray-500">{r.filename} | {new Date(r.created_at).toLocaleDateString()}</div>
                      {r.findings && <div className="text-sm text-blue-600 mt-1">{r.findings}</div>}
                    </div>
                    <button onClick={()=>setViewReport(r)} className="btn-blue text-sm">View DICOM</button>
                  </div>
                ))}
                {reports.length===0 && <div className="card text-center text-gray-400">No reports</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}