import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import api from './api';

export default function PathologistDash() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('requests');
  const [testRequests, setTestRequests] = useState([]);
  const [reports, setReports] = useState([]);
  const [uploadForm, setUploadForm] = useState({ test_request_id:'', patient_id:'', findings:'', file:null });
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [t,r] = await Promise.all([api.get('/test-requests'), api.get('/dicom/reports')]);
    setTestRequests(t.data.test_requests);
    setReports(r.data.reports);
  };

  const acceptRequest = async (id) => {
    await api.patch(`/test-requests/${id}/accept`);
    loadAll();
  };

  const upload = async e => {
    e.preventDefault();
    if (!uploadForm.file) return;
    setUploading(true); setMsg('');
    const fd = new FormData();
    fd.append('file', uploadForm.file);
    fd.append('test_request_id', uploadForm.test_request_id);
    fd.append('patient_id', uploadForm.patient_id);
    fd.append('findings', uploadForm.findings);
    try {
      await api.post('/dicom/upload', fd, { headers:{'Content-Type':'multipart/form-data'} });
      setMsg('✅ DICOM uploaded successfully!');
      setUploadForm({ test_request_id:'', patient_id:'', findings:'', file:null });
      loadAll();
    } catch(e) {
      setMsg('❌ ' + (e.response?.data?.error || 'Upload failed'));
    }
    setUploading(false);
  };

  const statusBadge = s => <span className={`badge-${s}`}>{s}</span>;
  const myRequests = testRequests.filter(t => t.status==='requested' || t.status==='accepted');
  const acceptedReqs = testRequests.filter(t => t.status==='accepted');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2"><span className="text-xl">🏥</span><span className="font-bold text-lg text-blue-600">MediConnect</span><span className="badge bg-purple-100 text-purple-700">Pathologist</span></div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">🔬 {user.name}</span>
            <button onClick={logout} className="text-sm text-red-500 hover:text-red-700">Logout</button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex gap-1 mb-6">
          {[{id:'requests',label:'📥 Requests'},{id:'upload',label:'📤 Upload DICOM'},{id:'reports',label:'📄 My Reports'}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab===t.id?'bg-purple-600 text-white shadow':'bg-white text-gray-600 hover:bg-gray-100'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* REQUESTS */}
        {tab==='requests' && (
          <div className="fade-in space-y-3">
            <h2 className="text-2xl font-bold mb-2">Test Requests</h2>
            {myRequests.map(t=>(
              <div key={t.id} className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{t.test_name}</div>
                    <div className="text-sm text-gray-500">
                      Patient: <span className="font-medium">{t.patient_name}</span> (ID: P-{t.patient_id})
                    </div>
                    <div className="text-sm text-gray-500">
                      Doctor: <span className="font-medium">{t.doctor_name}</span> (ID: D-{t.doctor_id})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(t.status)}
                    {t.status==='requested' && (
                      <button onClick={()=>acceptRequest(t.id)} className="btn-green text-sm">Accept</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {myRequests.length===0 && <div className="card text-center text-gray-400">No pending requests</div>}
          </div>
        )}

        {/* UPLOAD */}
        {tab==='upload' && (
          <div className="fade-in max-w-lg">
            <h2 className="text-2xl font-bold mb-4">📤 Upload DICOM Report</h2>
            {msg && <div className={`p-3 rounded-lg mb-4 text-sm ${msg.startsWith('✅')?'bg-green-50 text-green-700':'bg-red-50 text-red-700'}`}>{msg}</div>}
            <form onSubmit={upload} className="card space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Link to Test Request</label>
                <select className="input" value={uploadForm.test_request_id} onChange={e=>{
                  const tr = acceptedReqs.find(r=>r.id===parseInt(e.target.value));
                  setUploadForm({...uploadForm, test_request_id:e.target.value, patient_id: tr?tr.patient_id:uploadForm.patient_id});
                }}>
                  <option value="">Select request...</option>
                  {acceptedReqs.map(t=><option key={t.id} value={t.id}>{t.test_name} - {t.patient_name} (P-{t.patient_id})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Patient ID</label>
                <input className="input" type="number" placeholder="Patient ID" value={uploadForm.patient_id} onChange={e=>setUploadForm({...uploadForm,patient_id:e.target.value})} required/>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">DICOM File (.dcm only)</label>
                <input type="file" accept=".dcm" className="input" onChange={e=>setUploadForm({...uploadForm,file:e.target.files[0]})} required/>
                <p className="text-xs text-gray-400 mt-1">Only .dcm DICOM format accepted</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Findings</label>
                <textarea className="input" rows={3} placeholder="Report findings..." value={uploadForm.findings} onChange={e=>setUploadForm({...uploadForm,findings:e.target.value})}/>
              </div>
              <button className="btn-purple w-full" disabled={uploading}>{uploading?'Uploading...':'Upload DICOM Report'}</button>
            </form>
          </div>
        )}

        {/* MY REPORTS */}
        {tab==='reports' && (
          <div className="fade-in space-y-3">
            <h2 className="text-2xl font-bold mb-2">My Uploaded Reports</h2>
            {reports.map(r=>(
              <div key={r.id} className="card">
                <div className="font-medium">{r.filename}</div>
                <div className="text-sm text-gray-500">Patient: {r.patient_name} (P-{r.patient_id})</div>
                <div className="text-sm text-gray-500">{new Date(r.created_at).toLocaleDateString()}</div>
                {r.findings && <div className="text-sm text-blue-600 mt-1">{r.findings}</div>}
              </div>
            ))}
            {reports.length===0 && <div className="card text-center text-gray-400">No reports uploaded yet</div>}
          </div>
        )}
      </div>
    </div>
  );
}