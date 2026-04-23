import axios from 'axios';

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const api = axios.create({
  baseURL: isLocal 
    ? 'http://127.0.0.1:7000/api' 
    : 'https://telemed-backend-cylv.onrender.com/api'
});

api.interceptors.request.use(cfg => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(r => r, err => {
  if (err.response?.status === 401) {
    localStorage.clear();
    window.location.href = '/';
  }
  return Promise.reject(err);
});

export default api;