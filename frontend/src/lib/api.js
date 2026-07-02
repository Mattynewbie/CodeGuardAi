import { hasSupabaseConfig, supabase } from './supabase.js';

const configuredApiUrl = import.meta.env.VITE_API_URL;
const fallbackSessionKey = 'scsd_api_session';

export const API_URL = resolveApiUrl();

function resolveApiUrl() {
  if (configuredApiUrl && configuredApiUrl.trim()) {
    return configuredApiUrl.trim().replace(/\/$/, '');
  }

  if (typeof window !== 'undefined' && !import.meta.env.DEV) return '';
  return import.meta.env.DEV ? 'http://localhost:4100' : '';
}

export function saveApiSession(authPayload) {
  const session = authPayload?.session || authPayload;
  if (!session?.access_token) return;

  getSessionStore()?.setItem(
    fallbackSessionKey,
    JSON.stringify({
      session,
      user: authPayload?.user || null,
      profile: authPayload?.profile || null,
    }),
  );
  getLocalStore()?.removeItem(fallbackSessionKey);
}

export function loadApiSession() {
  try {
    const sessionStore = getSessionStore();
    const localStore = getLocalStore();
    const rawSession = sessionStore?.getItem(fallbackSessionKey) || localStore?.getItem(fallbackSessionKey);
    if (!rawSession) return null;
    if (!sessionStore?.getItem(fallbackSessionKey)) {
      sessionStore?.setItem(fallbackSessionKey, rawSession);
      localStore?.removeItem(fallbackSessionKey);
    }
    return JSON.parse(rawSession);
  } catch {
    return null;
  }
}

export function clearApiSession() {
  getSessionStore()?.removeItem(fallbackSessionKey);
  getLocalStore()?.removeItem(fallbackSessionKey);
}

export async function apiRequest(path, options = {}) {
  const { retryOnNetworkError = false, ...fetchOptions } = options;
  const headers = new Headers(options.headers || {});

  if (hasSupabaseConfig && supabase) {
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const token = data.session?.access_token || loadApiSession()?.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  } else {
    const token = loadApiSession()?.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetchWithOptionalRetry(path, {
    fetchOptions,
    headers,
    retryOnNetworkError,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export function loginWithBackend(payload) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function requestProfessorAccess(payload) {
  return apiRequest('/api/auth/access-request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function loadDashboard() {
  return apiRequest('/api/dashboard');
}

export function loadProjects() {
  return apiRequest('/api/projects');
}

export function loadSubmissions() {
  return apiRequest('/api/submissions');
}

export function loadComparisons() {
  return apiRequest('/api/comparisons');
}

export function loadReport(reportId) {
  return apiRequest(`/api/reports/${encodeURIComponent(reportId)}`);
}

export function askReportAssistant(reportId, payload) {
  return apiRequest(`/api/reports/${encodeURIComponent(reportId)}/assistant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    retryOnNetworkError: true,
  });
}

export function updateReportDecision(reportId, payload) {
  return apiRequest(`/api/reports/${encodeURIComponent(reportId)}/decision`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function removeComparison(comparisonId) {
  return apiRequest(`/api/comparisons/${encodeURIComponent(comparisonId)}`, { method: 'DELETE' });
}

export function removeProject(projectId) {
  return apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export function loadAdminUsers() {
  return apiRequest('/api/admin/users');
}

export function loadAccessRequests() {
  return apiRequest('/api/admin/access-requests');
}

export function createAdminUser(payload) {
  return apiRequest('/api/admin/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function updateAdminUserRole(userId, role) {
  return apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role }),
  });
}

export function updateAccessRequestStatus(requestId, status) {
  return apiRequest(`/api/admin/access-requests/${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });
}

function getSessionStore() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function getLocalStore() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

async function fetchWithOptionalRetry(path, { fetchOptions, headers, retryOnNetworkError }) {
  const bases = retryOnNetworkError ? buildApiUrlCandidates() : [API_URL];
  let lastNetworkError = null;

  for (const base of bases) {
    try {
      return await fetch(`${base}${path}`, {
        ...fetchOptions,
        headers,
      });
    } catch (error) {
      lastNetworkError = error;
    }
  }

  if (lastNetworkError) {
    throw new Error(
      `Cannot reach the CodeGuard AI API. Make sure the backend is running on port 4100, then try the AI chat again.`,
    );
  }

  throw new Error('Unable to send API request.');
}

function buildApiUrlCandidates() {
  const candidates = [API_URL];

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (hostname) candidates.push(`${protocol}//${hostname}:4100`);
  }

  candidates.push('http://127.0.0.1:4100', 'http://localhost:4100');
  return Array.from(new Set(candidates.filter((base) => typeof base === 'string' && base.length > 0)));
}
