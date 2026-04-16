import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './Login';
import PatientDash from './PatientDash';
import DoctorDash from './DoctorDash';
import PathologistDash from './PathologistDash';

function Protected({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full"/></div>;
  if (!user) return <Navigate to="/" />;
  if (role && user.role !== role) return <Navigate to="/" />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  const dashPath = user ? `/${user.role}` : '/';

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={dashPath}/> : <Login/>}/>
      <Route path="/patient" element={<Protected role="patient"><PatientDash/></Protected>}/>
      <Route path="/doctor" element={<Protected role="doctor"><DoctorDash/></Protected>}/>
      <Route path="/pathologist" element={<Protected role="pathologist"><PathologistDash/></Protected>}/>
      <Route path="*" element={<Navigate to="/"/>}/>
    </Routes>
  );
}

export default function App() {
  return <AuthProvider><BrowserRouter><AppRoutes/></BrowserRouter></AuthProvider>;
}