import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import api from './api';
import DicomViewer from './DicomViewer';

export default function PatientDash() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('dashboard');
  const [doctors, setDoctors] = useState([]);
  const [pathologists, setPathologists] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [testRequests, setTestRequests] = useState([]);
  const [reports, setReports] = useState([]);
  const [viewReport, setViewReport] = useState(null);

  // Booking form
  const [bookForm, setBookForm] = useState({ doctor_id:'', date:'', reason:'' });
  // Test request form
  const [testForm, setTestForm] = useState({ doctor_id:'', pathologist_id:'', test_name:'', appointment_id:'' });
  // AI
  const [symptoms, setSymptoms] = useState('');
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHistory, setAiHistory] = useState([]);

  const chatEndRef = useRef(null);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [aiHistory]);

  const loadAll = async () => {
    const [d, p, a, t, r] = await Promise.all([
      api.get('/doctors'), api.get('/pathologists'),
      api.get('/appointments'), api.get('/test-requests'),
      api.get('/dicom/reports')
    ]);
    setDoctors(d.data.doctors);
    setPathologists(p.data.pathologists);
    setAppointments(a.data.appointments);
    setTestRequests(t.data.test_requests);
    setReports(r.data.reports);
  };

  const bookAppointment = async e => {
    e.preventDefault();
    await api.post('/appointments', bookForm);
    setBookForm({ doctor_id:'', date:'', reason:'' });
    loadAll(); setTab('appointments');
  };

  const requestTest = async e => {
    e.preventDefault();
    await api.post('/test-requests', testForm);
    setTestForm({ doctor_id:'', pathologist_id:'', test_name:'', appointment_id:'' });
    loadAll(); setTab('tests');
  };

  const analyzeSymptoms = async () => {
    if (!symptoms.trim()) return;
    setAiLoading(true);
    setAiHistory(h => [...h, { role:'user', text: symptoms }]);
    try {
      const r = await api.post('/ai/analyze', { symptoms });
      setAiResult(r.data.result);
      setAiHistory(h => [...h, { role:'ai', data: r.data.result }]);
    } catch(e) {
      setAiHistory(h => [...h, { role:'ai', data:{ message:'Sorry, something went wrong.' } }]);
    }
    setSymptoms(''); setAiLoading(false);
  };

  const statusBadge = s => <span className={`badge-${s}`}>{s}</span>;

  const tabs = [
    { id:'dashboard', label:'🏠 Dashboard' },
    { id:'book', label:'📅 Book' },
    { id:'appointments', label:'📋 Appointments' },
    { id:'tests', label:'🧪 Tests' },
    { id:'reports', label:'📄 Reports' },
    { id:'ai', label:'🤖 AI Assistant' },
  ];

  // Find accepted appointments with suggested tests
  const acceptedWithTests = appointments.filter(a => a.status === 'accepted' && a.suggested_test);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Bar */}
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏥</span>
            <span className="font-bold text-lg text-blue-600">MediConnect</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">👤 {user.name}</span>
            <button onClick={logout} className="text-sm text-red-500 hover:text-red-700">Logout</button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition
                ${tab===t.id?'bg-blue-600 text-white shadow':'bg-white text-gray-600 hover:bg-gray-100'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* DASHBOARD */}
        {tab==='dashboard' && (
          <div className="fade-in space-y-6">
            <h2 className="text-2xl font-bold">Welcome, {user.name} 👋</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { l:'Appointments', v:appointments.length, c:'bg-blue-50 text-blue-700', i:'📅' },
                { l:'Pending', v:appointments.filter(a=>a.status==='pending').length, c:'bg-yellow-50 text-yellow-700', i:'⏳' },
                { l:'Test Requests', v:testRequests.length, c:'bg-purple-50 text-purple-700', i:'🧪' },
                { l:'Reports', v:reports.length, c:'bg-green-50 text-green-700', i:'📄' },
              ].map((s,i)=>(
                <div key={i} className={`card ${s.c}`}>
                  <div className="text-2xl mb-1">{s.i}</div>
                  <div className="text-2xl font-bold">{s.v}</div>
                  <div className="text-sm opacity-75">{s.l}</div>
                </div>
              ))}
            </div>
            {/* Recent activity */}
            <div className="card">
              <h3 className="font-semibold mb-3">Recent Appointments</h3>
              {appointments.slice(0,3).map(a=>(
                <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="font-medium">{a.doctor_name}</div>
                    <div className="text-xs text-gray-500">{new Date(a.date).toLocaleDateString()}</div>
                  </div>
                  {statusBadge(a.status)}
                </div>
              ))}
              {appointments.length===0 && <p className="text-gray-400 text-sm">No appointments yet</p>}
            </div>
          </div>
        )}

        {/* BOOK APPOINTMENT */}
        {tab==='book' && (
          <div className="fade-in max-w-lg">
            <h2 className="text-2xl font-bold mb-4">📅 Book Appointment</h2>
            <form onSubmit={bookAppointment} className="card space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Select Doctor</label>
                <select className="input" value={bookForm.doctor_id} onChange={e=>setBookForm({...bookForm,doctor_id:e.target.value})} required>
                  <option value="">Choose a doctor...</option>
                  {doctors.map(d=><option key={d.id} value={d.id}>{d.name} - {d.specialization}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Date & Time</label>
                <input type="datetime-local" className="input" value={bookForm.date} onChange={e=>setBookForm({...bookForm,date:e.target.value})} required/>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reason / Symptoms</label>
                <textarea className="input" rows={3} value={bookForm.reason} onChange={e=>setBookForm({...bookForm,reason:e.target.value})} placeholder="Describe your symptoms..."/>
              </div>
              <button className="btn-blue w-full">Book Appointment</button>
            </form>
          </div>
        )}

        {/* APPOINTMENTS LIST */}
        {tab==='appointments' && (
          <div className="fade-in">
            <h2 className="text-2xl font-bold mb-4">📋 My Appointments</h2>
            <div className="space-y-3">
              {appointments.map(a=>(
                <div key={a.id} className="card">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold">{a.doctor_name}</div>
                      <div className="text-sm text-gray-500">{new Date(a.date).toLocaleString()}</div>
                      {a.reason && <div className="text-sm mt-1">Reason: {a.reason}</div>}
                      {a.doctor_notes && <div className="text-sm mt-1 text-blue-600">📝 Doctor Notes: {a.doctor_notes}</div>}
                      {a.suggested_test && <div className="text-sm mt-1 text-purple-600">🧪 Suggested Test: {a.suggested_test}</div>}
                    </div>
                    {statusBadge(a.status)}
                  </div>
                </div>
              ))}
              {appointments.length===0 && <div className="card text-center text-gray-400">No appointments yet. Book one!</div>}
            </div>
          </div>
        )}

        {/* TEST REQUESTS */}
        {tab==='tests' && (
          <div className="fade-in">
            <h2 className="text-2xl font-bold mb-4">🧪 Test Requests</h2>

            {/* Show suggested tests from doctor */}
            {acceptedWithTests.length > 0 && (
              <div className="card mb-4 border-l-4 border-purple-500">
                <h3 className="font-semibold text-purple-700 mb-2">Doctor Suggested Tests</h3>
                {acceptedWithTests.map(a=>(
                  <div key={a.id} className="text-sm py-1">
                    <span className="font-medium">{a.doctor_name}</span> suggested: <span className="text-purple-600 font-medium">{a.suggested_test}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Request form */}
            <form onSubmit={requestTest} className="card mb-4 space-y-3">
              <h3 className="font-semibold">Request a Test</h3>
              <select className="input" value={testForm.appointment_id} onChange={e => {
                const apt = appointments.find(a=>a.id===parseInt(e.target.value));
                setTestForm({...testForm, appointment_id:e.target.value, doctor_id: apt?apt.doctor_id:'', test_name: apt?.suggested_test||testForm.test_name });
              }}>
                <option value="">Link to appointment (optional)</option>
                {acceptedWithTests.map(a=><option key={a.id} value={a.id}>{a.doctor_name} - {a.suggested_test}</option>)}
              </select>
              <select className="input" value={testForm.doctor_id} onChange={e=>setTestForm({...testForm,doctor_id:e.target.value})} required>
                <option value="">Select referring doctor...</option>
                {doctors.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select className="input" value={testForm.pathologist_id} onChange={e=>setTestForm({...testForm,pathologist_id:e.target.value})} required>
                <option value="">Select pathologist/lab...</option>
                {pathologists.map(p=><option key={p.id} value={p.id}>{p.name} - {p.specialization}</option>)}
              </select>
              <input className="input" placeholder="Test name (e.g. MRI Brain)" value={testForm.test_name} onChange={e=>setTestForm({...testForm,test_name:e.target.value})} required/>
              <button className="btn-purple w-full">Send Request</button>
            </form>

            {/* List */}
            <div className="space-y-3">
              {testRequests.map(t=>(
                <div key={t.id} className="card flex items-center justify-between">
                  <div>
                    <div className="font-medium">{t.test_name}</div>
                    <div className="text-xs text-gray-500">Doctor: {t.doctor_name}</div>
                  </div>
                  {statusBadge(t.status)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* REPORTS */}
        {tab==='reports' && (
          <div className="fade-in">
            <h2 className="text-2xl font-bold mb-4">📄 My DICOM Reports</h2>
            {viewReport ? (
              <div>
                <button onClick={()=>setViewReport(null)} className="btn-gray mb-4">← Back to list</button>
                <DicomViewer reportId={viewReport.id} findings={viewReport.findings}/>
              </div>
            ) : (
              <div className="space-y-3">
                {reports.map(r=>(
                  <div key={r.id} className="card flex items-center justify-between">
                    <div>
                      <div className="font-medium">{r.filename}</div>
                      <div className="text-xs text-gray-500">By: {r.uploader_name} | {new Date(r.created_at).toLocaleDateString()}</div>
                      {r.findings && <div className="text-sm text-blue-600 mt-1">Findings: {r.findings}</div>}
                    </div>
                    <button onClick={()=>setViewReport(r)} className="btn-blue text-sm">View DICOM</button>
                  </div>
                ))}
                {reports.length===0 && <div className="card text-center text-gray-400">No reports yet</div>}
              </div>
            )}
          </div>
        )}

        {/* AI ASSISTANT */}
        {tab==='ai' && (
          <div className="fade-in max-w-2xl">
            <h2 className="text-2xl font-bold mb-4">🤖 AI Health Assistant</h2>
            <div className="card" style={{height:'60vh', display:'flex', flexDirection:'column'}}>
              {/* Chat area */}
              <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
                {aiHistory.length===0 && (
                  <div className="text-center text-gray-400 mt-10">
                    <div className="text-4xl mb-2">🤖</div>
                    <p>Describe your symptoms and I'll suggest possible procedures and tests.</p>
                    <div className="flex flex-wrap justify-center gap-2 mt-4">
                      {['headache','chest pain','fever','back pain','dizziness'].map(s=>(
                        <button key={s} onClick={()=>setSymptoms(s)} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100">{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {aiHistory.map((m,i)=>(
                  <div key={i} className={`flex ${m.role==='user'?'justify-end':'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm
                      ${m.role==='user'?'bg-blue-600 text-white rounded-br-sm':'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                      {m.role==='user' ? m.text : (
                        <div className="space-y-2">
                          <p className="font-medium">{m.data.message}</p>
                          {m.data.urgency && <span className={`badge-${m.data.urgency}`}>Urgency: {m.data.urgency}</span>}
                          {m.data.matched_symptoms && (
                            <div><span className="font-medium">Symptoms:</span> {m.data.matched_symptoms.join(', ')}</div>
                          )}
                          {m.data.suggestions && (
                            <div>
                              <span className="font-medium">💡 Suggestions:</span>
                              <ul className="list-disc ml-4 mt-1">{m.data.suggestions.map((s,j)=><li key={j}>{s}</li>)}</ul>
                            </div>
                          )}
                          {m.data.recommended_tests && (
                            <div>
                              <span className="font-medium">🧪 Recommended Tests:</span>
                              <ul className="list-disc ml-4 mt-1">{m.data.recommended_tests.map((t,j)=><li key={j}>{t}</li>)}</ul>
                            </div>
                          )}
                          {m.data.specialists && (
                            <div><span className="font-medium">👨‍⚕️ See:</span> {m.data.specialists.join(', ')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {aiLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-2xl px-4 py-3 rounded-bl-sm">
                      <div className="flex gap-1"><div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"/><div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'.15s'}}/><div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'.3s'}}/></div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef}/>
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Describe your symptoms..." value={symptoms}
                  onChange={e=>setSymptoms(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&analyzeSymptoms()}/>
                <button onClick={analyzeSymptoms} disabled={aiLoading||!symptoms.trim()} className="btn-blue">
                  {aiLoading?'...':'Send'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}