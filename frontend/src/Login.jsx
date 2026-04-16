import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [isReg, setIsReg] = useState(false);
  const [form, setForm] = useState({ email:'', password:'', name:'', role:'patient', specialization:'' });
  const [err, setErr] = useState('');
  const { login, register } = useAuth();
  const nav = useNavigate();

  const handle = async e => {
    e.preventDefault(); setErr('');
    try {
      const u = isReg ? await register(form) : await login(form.email, form.password);
      nav(`/${u.role}`);
    } catch(e) { setErr(e.response?.data?.error || 'Error occurred'); }
  };

  const set = (k,v) => setForm({...form,[k]:v});

  const demos = [
    { label:'Patient', email:'patient@test.com' },
    { label:'Doctor', email:'doctor@test.com' },
    { label:'Pathologist', email:'path@test.com' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-3">
            <span className="text-3xl">🏥</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">MediConnect</h1>
          <p className="text-gray-500 mt-1">Telemedicine Platform</p>
        </div>

        <div className="card">
          {/* Tabs */}
          <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
            <button onClick={()=>setIsReg(false)} className={`flex-1 py-2 rounded-md text-sm font-medium transition ${!isReg?'bg-white shadow text-blue-600':'text-gray-500'}`}>Sign In</button>
            <button onClick={()=>setIsReg(true)} className={`flex-1 py-2 rounded-md text-sm font-medium transition ${isReg?'bg-white shadow text-blue-600':'text-gray-500'}`}>Register</button>
          </div>

          {err && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{err}</div>}

          <form onSubmit={handle} className="space-y-4">
            {isReg && (
              <>
                <input className="input" placeholder="Full Name" value={form.name} onChange={e=>set('name',e.target.value)} required/>
                <select className="input" value={form.role} onChange={e=>set('role',e.target.value)}>
                  <option value="patient">Patient</option>
                  <option value="doctor">Doctor</option>
                  <option value="pathologist">Pathologist</option>
                </select>
                {form.role==='doctor' && <input className="input" placeholder="Specialization" value={form.specialization} onChange={e=>set('specialization',e.target.value)}/>}
              </>
            )}
            <input className="input" type="email" placeholder="Email" value={form.email} onChange={e=>set('email',e.target.value)} required/>
            <input className="input" type="password" placeholder="Password" value={form.password} onChange={e=>set('password',e.target.value)} required/>
            <button className="btn-blue w-full">{isReg?'Create Account':'Sign In'}</button>
          </form>

          {/* Demo accounts */}
          {!isReg && (
            <div className="mt-6 pt-4 border-t">
              <p className="text-xs text-gray-500 mb-2 text-center">Quick Demo Login (password: 123456)</p>
              <div className="flex gap-2">
                {demos.map(d=>(
                  <button key={d.email} onClick={()=>set('email',d.email)||set('password','123456')}
                    className="flex-1 text-xs py-2 px-2 bg-gray-50 hover:bg-blue-50 rounded-lg text-gray-600 hover:text-blue-600 transition">
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}