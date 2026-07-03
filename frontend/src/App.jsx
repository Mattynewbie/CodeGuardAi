import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileCode2,
  FileText,
  Folder,
  Gauge,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  NotebookPen,
  Percent,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  apiRequest,
  askReportAssistant,
  clearApiSession,
  createAdminUser,
  loadComparisons,
  loadAccessRequests,
  loadApiSession,
  loadAdminUsers,
  loadDashboard,
  loadProjects,
  loadReport,
  loadSubmissions,
  loginWithBackend,
  removeComparison,
  removeProject,
  requestProfessorAccess,
  saveApiSession,
  updateMyProfile,
  updateSavedApiProfile,
  updateReportDecision,
  updateAccessRequestStatus,
  updateAdminUserRole,
} from './lib/api.js';
import { hasSupabaseConfig, supabase } from './lib/supabase.js';

const supportedExtensions = [
  '.zip',
  '.rar',
  '.php',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.cs',
  '.cpp',
  '.c',
  '.h',
  '.html',
  '.css',
  '.sql',
  '.rb',
  '.go',
  '.rs',
];

const pieColors = ['#4f9f5f', '#f2bd4d', '#fb7a32', '#e94834'];
const seenNotificationStorageKey = 'scsd_seen_notifications';
const systemBrandName = 'CodeGuard AI';
const systemTagline = 'An AI-Integrated Source Code Similarity Checker';
const systemFullName = `${systemBrandName}: ${systemTagline}`;
const systemCopyrightYear = 2026;
const workspaceNavigationStorageKey = 'codeguard_workspace_navigation';
const workspaceViews = new Set([
  'dashboard',
  'upload',
  'submissions',
  'projects',
  'comparisons',
  'checks',
  'history',
  'logs',
  'reports',
  'report',
  'admin',
  'settings',
]);

function App() {
  const [initialWorkspaceNavigation] = useState(() => loadWorkspaceNavigationState());
  const [session, setSession] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [role, setRole] = useState('User');
  const [roleLoaded, setRoleLoaded] = useState(!supabase);
  const [activeView, setActiveView] = useState(() => initialWorkspaceNavigation.activeView);
  const [selectedReport, setSelectedReport] = useState(null);
  const [restoredReportId, setRestoredReportId] = useState(() => initialWorkspaceNavigation.reportId);
  const [projects, setProjects] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [comparisons, setComparisons] = useState([]);
  const [dashboard, setDashboard] = useState(() => makeFallbackDashboard([]));
  const [users, setUsers] = useState([]);
  const [accessRequests, setAccessRequests] = useState([]);
  const [loadingDashboard, setLoadingDashboard] = useState(false);

  useEffect(() => {
    const savedApiSession = loadApiSession();
    if (savedApiSession?.session?.access_token && savedApiSession?.user) {
      setSession(savedApiSession.user);
      setRole(savedApiSession.profile?.role === 'admin' ? 'Admin' : 'User');
      setRoleLoaded(true);
    }

    if (!supabase) {
      setRoleLoaded(true);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        clearApiSession();
        setSession(data.session.user);
        loadProfileRole(data.session.user.id);
      } else {
        setRoleLoaded(true);
      }
    }).catch(() => setRoleLoaded(true));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, authSession) => {
      if (!authSession?.user && loadApiSession()?.user) return;
      if (authSession?.user) clearApiSession();
      setSession(authSession?.user ?? null);
      if (authSession?.user) {
        setRoleLoaded(false);
        loadProfileRole(authSession.user.id);
      } else {
        setRoleLoaded(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfileRole(userId) {
    if (!supabase) {
      setRoleLoaded(true);
      return;
    }

    try {
      const { data } = await supabase.from('users').select('role').eq('id', userId).single();
      setRole(data?.role === 'admin' ? 'Admin' : 'User');
    } finally {
      setRoleLoaded(true);
    }
  }

  function handleDemoLogin(nextRole, email) {
    setRole(nextRole);
    setRoleLoaded(true);
    setSession({
      id: 'local-user',
      email,
      user_metadata: { full_name: nameFromEmail(email) },
    });
  }

  function handleBackendAuth(authPayload) {
    saveApiSession(authPayload);
    setRole(authPayload.profile?.role === 'admin' ? 'Admin' : 'User');
    setRoleLoaded(true);
    setSession({
      id: authPayload.user.id,
      email: authPayload.user.email,
      user_metadata: authPayload.user.user_metadata || {
        full_name: authPayload.profile?.fullName || nameFromEmail(authPayload.user.email),
      },
    });
  }

  function handleProfileUpdated(profile) {
    const fullName = profile?.fullName || profile?.full_name || getDisplayName(session);
    const email = profile?.email || session?.email;

    updateSavedApiProfile({ ...profile, fullName, email });
    if (profile?.role) setRole(profile.role === 'admin' ? 'Admin' : 'User');
    setSession((current) => ({
      ...(current || {}),
      email,
      user_metadata: {
        ...(current?.user_metadata || {}),
        full_name: fullName,
      },
    }));
    setDashboard((current) => ({
      ...current,
      profile: {
        ...(current?.profile || {}),
        displayName: fullName,
      },
    }));
  }

  async function handleLogout() {
    clearApiSession();
    clearWorkspaceNavigationState();
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setShowAuth(false);
    setRestoredReportId('');
    setActiveView('dashboard');
    resetWorkspaceState();
  }

  function resetWorkspaceState() {
    setProjects([]);
    setSubmissions([]);
    setComparisons([]);
    setDashboard(makeFallbackDashboard([]));
    setUsers([]);
    setAccessRequests([]);
    setSelectedReport(null);
  }

  function addAnalyzedProject(project, report) {
    setProjects((current) => [project, ...current]);
    setSubmissions((current) => [projectToSubmission(project), ...current]);
    setSelectedReport(report);
    setRestoredReportId(report?.id || project.reportId || project.id || '');
    setActiveView('report');
    refreshWorkspace();
  }

  async function handleOpenProjectReport(project) {
    const reportId = project?.reportId || project?.id;
    await handleOpenReportById(reportId, project);
  }

  async function handleOpenReportById(reportId, fallbackProject) {
    setRestoredReportId(reportId || '');
    await openReportById(reportId, setSelectedReport, setActiveView, fallbackProject);
  }

  async function handleReportDecision(reportId, decision) {
    const data = await updateReportDecision(reportId, { decision });
    setSelectedReport(data.report || null);
    await refreshWorkspace();
    return data.report;
  }

  async function handleDeleteComparison(comparisonId) {
    const confirmed = window.confirm('Delete this comparison and its report? Uploaded submissions will stay in the repository.');
    if (!confirmed) return;

    await removeComparison(comparisonId);
    setComparisons((current) => current.filter((comparison) => comparison.id !== comparisonId));
    if (selectedReport?.id === comparisonId) {
      setSelectedReport(null);
      setRestoredReportId('');
      setActiveView('comparisons');
    }
    await refreshWorkspace();
  }

  async function refreshWorkspace() {
    if (!session) return;

    setLoadingDashboard(true);
    try {
      const [dashboardData, projectData, submissionData, comparisonData, userData, accessRequestData] = await Promise.all([
        loadDashboard(),
        loadProjects(),
        loadSubmissions(),
        loadComparisons(),
        role === 'Admin' ? loadAdminUsers() : Promise.resolve({ users: [] }),
        role === 'Admin' ? loadAccessRequests() : Promise.resolve({ accessRequests: [] }),
      ]);

      setDashboard(dashboardData);
      setProjects(projectData.projects || []);
      setSubmissions(submissionData.submissions || (projectData.projects || []).map(projectToSubmission));
      setComparisons(comparisonData.comparisons || []);
      setUsers(userData.users || []);
      setAccessRequests(accessRequestData.accessRequests || []);
    } catch {
      setDashboard(makeFallbackDashboard([]));
      setProjects([]);
      setSubmissions([]);
      setComparisons([]);
      setUsers([]);
      setAccessRequests([]);
    } finally {
      setLoadingDashboard(false);
    }
  }

  useEffect(() => {
    if (session) refreshWorkspace();
  }, [session, role]);

  useEffect(() => {
    if (!session || role !== 'Admin') return undefined;

    let cancelled = false;
    async function refreshAccessRequestsOnly() {
      try {
        const data = await loadAccessRequests();
        if (!cancelled) setAccessRequests(data.accessRequests || []);
      } catch {
        // Keep the current list if a background refresh fails.
      }
    }

    const intervalId = window.setInterval(refreshAccessRequestsOnly, 30000);
    window.addEventListener('focus', refreshAccessRequestsOnly);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshAccessRequestsOnly);
    };
  }, [session, role]);

  useEffect(() => {
    if (!session) return;
    const reportId = selectedReport?.id || restoredReportId || '';
    saveWorkspaceNavigationState({ activeView, reportId });
  }, [session, activeView, selectedReport, restoredReportId]);

  useEffect(() => {
    if (!session || activeView !== 'report' || selectedReport || !restoredReportId) return undefined;

    let cancelled = false;
    loadReport(restoredReportId)
      .then((data) => {
        if (!cancelled) setSelectedReport(data.report || null);
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedReport(null);
          setActiveView('reports');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session, activeView, selectedReport, restoredReportId]);

  useEffect(() => {
    if (session && roleLoaded && activeView === 'admin' && role !== 'Admin') {
      setActiveView('dashboard');
    }
  }, [session, roleLoaded, activeView, role]);

  if (!session) {
    return (
      <>
        <LandingPage onEnter={() => setShowAuth(true)} />
        {showAuth && (
          <AuthScreen
            isModal
            onDemoLogin={handleDemoLogin}
            onBackendAuth={handleBackendAuth}
            onBack={() => setShowAuth(false)}
            role={role}
            setRole={setRole}
          />
        )}
      </>
    );
  }

  const isAdmin = role === 'Admin';

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        isAdmin={isAdmin}
        role={role}
        user={session}
        onLogout={handleLogout}
      />
      <main className="main-content">
        <Topbar
          role={role}
          user={session}
          dashboard={dashboard}
          accessRequests={accessRequests}
          activeView={activeView}
          setActiveView={setActiveView}
          onOpenReport={handleOpenReportById}
          onLogout={handleLogout}
        />

        {activeView === 'dashboard' && (
          <UserDashboard
            dashboard={dashboard}
            loading={loadingDashboard}
            onNavigate={setActiveView}
            onOpenReport={() => setActiveView('report')}
            onOpenReportById={handleOpenReportById}
          />
        )}

        {activeView === 'upload' && <UploadWorkspace onAnalyzed={addAnalyzedProject} />}

        {['submissions', 'projects'].includes(activeView) && <SubmissionRepository submissions={submissions} />}

        {['comparisons', 'checks'].includes(activeView) && (
          <ComparisonHistory
            comparisons={comparisons}
            onOpenReport={handleOpenReportById}
            onDeleteComparison={handleDeleteComparison}
          />
        )}

        {['history', 'logs'].includes(activeView) && (
          <HistoryView
            projects={projects}
            onOpenReport={handleOpenProjectReport}
          />
        )}

        {['report', 'reports'].includes(activeView) && (
          <ReportView report={selectedReport} onNavigate={setActiveView} onUpdateDecision={handleReportDecision} />
        )}

        {activeView === 'admin' && isAdmin && (
          <AdminDashboard
            projects={projects}
            users={users}
            accessRequests={accessRequests}
            onDeleteProject={async (projectId) => {
              await removeProject(projectId);
              await refreshWorkspace();
            }}
            onChangeUserRole={async (userId, nextRole) => {
              await updateAdminUserRole(userId, nextRole);
              await refreshWorkspace();
            }}
            onCreateUser={async (payload) => {
              await createAdminUser(payload);
              await refreshWorkspace();
            }}
            onUpdateAccessRequest={async (requestId, status) => {
              await updateAccessRequestStatus(requestId, status);
              await refreshWorkspace();
            }}
            onOpenReport={handleOpenProjectReport}
          />
        )}

        {activeView === 'settings' && <SettingsView user={session} role={role} onProfileUpdated={handleProfileUpdated} />}
      </main>
    </div>
  );
}

function makeFallbackDashboard(projects) {
  const safeProjects = projects;
  const average = safeProjects.length
    ? Math.round(
        safeProjects.reduce((total, project) => total + Number(project.highestSimilarity || 0), 0) /
          safeProjects.length,
      )
    : 0;
  const flagged = safeProjects.filter((project) => Number(project.highestSimilarity || 0) >= 70).length;
  const approved = safeProjects.filter((project) => normalizeReviewDecisionStatus(project.reviewDecision) === 'approved').length;
  const resubmissionRequested = safeProjects.filter(
    (project) => normalizeReviewDecisionStatus(project.reviewDecision) === 'resubmit',
  ).length;

  return {
    profile: {
      displayName: 'Instructor',
      workspace: 'Review desk',
    },
    generatedAt: new Date().toISOString(),
    notifications: flagged,
    metrics: [
      { label: 'Projects in Review', value: safeProjects.length, note: 'local workspace', tone: 'blue' },
      { label: 'Completed Checks', value: safeProjects.length, note: 'available reports', tone: 'green' },
      { label: 'Mean Similarity', value: `${average}%`, note: 'current list', tone: 'orange' },
      { label: 'Needs Review', value: flagged, note: '70% and above', tone: 'red' },
      { label: 'Approved', value: approved, note: 'instructor cleared', tone: 'green' },
      { label: 'Resubmission Requested', value: resubmissionRequested, note: 'needs student action', tone: 'orange' },
    ],
    trend: buildClientTrend(safeProjects),
    distribution: buildClientDistribution(safeProjects),
    recentChecks: safeProjects.slice(0, 5).map((project) => ({
      id: project.id,
      reportId: project.reportId,
      project: project.title,
      owner: project.owner,
      checkedOn: project.createdAt,
      score: project.highestSimilarity,
      status: reviewDecisionLabel(project.reviewDecision) || statusFromScore(project.highestSimilarity),
      reviewDecision: project.reviewDecision || null,
    })),
    topMatches: [...safeProjects]
      .sort((a, b) => Number(b.highestSimilarity || 0) - Number(a.highestSimilarity || 0))
      .slice(0, 5)
      .map((project) => ({
        id: project.id,
        reportId: project.reportId,
        name: project.title,
        owner: project.owner,
        score: project.highestSimilarity,
        reviewDecision: project.reviewDecision || null,
      })),
  };
}

function projectToSubmission(project) {
  return {
    id: project.id,
    studentName: project.studentName || project.owner || 'Student',
    subject: project.subject || 'Unassigned',
    section: project.section || 'Unassigned',
    title: project.title,
    submissionDate: project.createdAt,
    fileCount: project.files || 0,
    programmingLanguage: project.language || 'Mixed',
    uploadStatus: project.status || 'Uploaded',
    highestSimilarity: Number(project.highestSimilarity || 0),
    reportId: project.reportId || project.id,
  };
}

function projectToComparison(project) {
  const reviewStatus = reviewDecisionLabel(project.reviewDecision) || 'Pending Review';

  return {
    id: project.reportId || project.id,
    reportId: project.reportId || project.id,
    submissionA: 'Previous submission',
    submissionB: project.title,
    similarityScore: Number(project.highestSimilarity || 0),
    scanDate: project.createdAt,
    reviewDecision: project.reviewDecision || null,
    reviewStatus,
  };
}

async function openReportById(reportId, setSelectedReport, setActiveView, fallbackProject) {
  if (!reportId) {
    setActiveView('report');
    return;
  }

  try {
    const data = await loadReport(reportId);
    setSelectedReport(data.report);
  } catch {
    setSelectedReport(fallbackProject ? buildProjectReportFallback(fallbackProject) : null);
  }
  setActiveView('report');
}

function loadWorkspaceNavigationState() {
  const fallbackState = { activeView: 'dashboard', reportId: '' };

  try {
    const rawState = getWorkspaceNavigationStore()?.getItem(workspaceNavigationStorageKey);
    if (!rawState) return fallbackState;
    const parsedState = JSON.parse(rawState);
    const activeView = workspaceViews.has(parsedState?.activeView) ? parsedState.activeView : 'dashboard';
    const reportId = sanitizeSavedReportId(parsedState?.reportId);
    return { activeView, reportId };
  } catch {
    return fallbackState;
  }
}

function saveWorkspaceNavigationState({ activeView, reportId }) {
  if (!workspaceViews.has(activeView)) return;

  try {
    getWorkspaceNavigationStore()?.setItem(
      workspaceNavigationStorageKey,
      JSON.stringify({
        activeView,
        reportId: sanitizeSavedReportId(reportId),
      }),
    );
  } catch {
    // Storage can be unavailable in private browsing or restricted webviews.
  }
}

function clearWorkspaceNavigationState() {
  try {
    getWorkspaceNavigationStore()?.removeItem(workspaceNavigationStorageKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function getWorkspaceNavigationStore() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function sanitizeSavedReportId(reportId) {
  const cleanReportId = String(reportId || '').trim();
  return /^[a-zA-Z0-9_-]{1,120}$/.test(cleanReportId) ? cleanReportId : '';
}

function buildClientTrend(projects) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const dayProjects = projects.filter((project) => {
      const created = new Date(project.createdAt);
      return (
        created.getFullYear() === date.getFullYear() &&
        created.getMonth() === date.getMonth() &&
        created.getDate() === date.getDate()
      );
    });
    const value = dayProjects.length
      ? Math.round(
          dayProjects.reduce((total, project) => total + Number(project.highestSimilarity || 0), 0) /
            dayProjects.length,
        )
      : 0;
    return { label: formatShortDate(date), value };
  });
}

function buildClientDistribution(projects) {
  const buckets = [
    { label: '0% - 20% (Low)', min: 0, max: 20, color: '#4f9f5f' },
    { label: '21% - 50% (Moderate)', min: 21, max: 50, color: '#f2bd4d' },
    { label: '51% - 80% (High)', min: 51, max: 80, color: '#fb7a32' },
    { label: '81% - 100% (Very High)', min: 81, max: 100, color: '#e94834' },
  ];
  const total = projects.length || 1;

  return buckets.map((bucket) => {
    const count = projects.filter((project) => {
      const score = Number(project.highestSimilarity || 0);
      return score >= bucket.min && score <= bucket.max;
    }).length;
    return {
      ...bucket,
      count,
      percent: Math.round((count / total) * 1000) / 10,
    };
  });
}

function statusFromScore(score) {
  if (score >= 81) return 'Very High';
  if (score >= 51) return 'High';
  if (score >= 21) return 'Moderate';
  return 'Low';
}

function normalizeReviewDecisionStatus(decision) {
  const status = typeof decision === 'string' ? decision : decision?.status;
  const normalizedStatus = String(status || '').trim().toLowerCase().replace(/[-_\s]+/g, '_');

  if (['approved', 'approve', 'cleared'].includes(normalizedStatus)) return 'approved';
  if (['resubmit', 'resubmission', 'resubmission_requested', 'request_resubmission'].includes(normalizedStatus)) {
    return 'resubmit';
  }

  return '';
}

function reviewDecisionLabel(decision) {
  const normalizedStatus = normalizeReviewDecisionStatus(decision);
  if (normalizedStatus === 'approved') return 'Approved';
  if (normalizedStatus === 'resubmit') return 'Resubmission Requested';
  return '';
}

function reviewStatusClass(decision) {
  const normalizedStatus = normalizeReviewDecisionStatus(decision);
  if (normalizedStatus === 'approved') return 'ok';
  if (normalizedStatus === 'resubmit') return 'warning';
  return 'admin';
}

function projectStatusClass(status) {
  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedStatus.includes('resubmission') || normalizedStatus.includes('moderate')) return 'warning';
  if (normalizedStatus.includes('flag') || normalizedStatus.includes('high')) return 'danger';
  return 'ok';
}

function nameFromEmail(email) {
  return email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getDisplayName(user) {
  return user?.user_metadata?.full_name || nameFromEmail(user?.email || 'instructor@local');
}

function displayRoleLabel(role) {
  return role === 'Admin' ? 'Admin' : 'Professor';
}

function initialsFromName(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function formatShortDate(dateValue) {
  return new Date(dateValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatLongDate(dateValue = new Date()) {
  return new Date(dateValue).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(dateValue) {
  return new Date(dateValue).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAiStatus(status = 'not loaded') {
  return status.replaceAll('_', ' ');
}

function getReadableAuthError(authError) {
  const message = authError?.message || 'Unable to sign in right now.';
  const normalized = message.toLowerCase();

  if (normalized.includes('failed to fetch') || normalized.includes('fetch')) {
    return 'Cannot reach Supabase Auth. Check the Supabase keys, internet connection, and rerun the seeded accounts SQL if the users were imported manually.';
  }

  if (normalized.includes('invalid login')) {
    return 'Email or password is incorrect. Use the seeded credentials or reset this account in Supabase Auth.';
  }

  return message;
}

function shouldUseBackendAuthFallback(authError) {
  const message = authError?.message?.toLowerCase() || '';
  return message.includes('failed to fetch') || message.includes('fetch');
}

function LandingPage({ onEnter }) {
  const navItems = ['Home', 'Features', 'How It Works', 'About', 'Contact'];
  const trustMarks = [
    { icon: Shield, label: 'Secure & Private' },
    { icon: FileCode2, label: 'Supports Multiple Languages' },
    { icon: BarChart3, label: 'Detailed Reports' },
  ];
  const featureCards = [
    {
      icon: UploadCloud,
      title: 'Upload & Analyze',
      copy: 'Upload your source code files or compressed folders and analyze instantly.',
    },
    {
      icon: Search,
      title: 'Similarity Detection',
      copy: 'Detect exact matches, copied logic, and similar code even with renamed variables.',
    },
    {
      icon: FileText,
      title: 'Detailed Reports',
      copy: 'Get comprehensive reports with similarity score and highlighted matches.',
    },
    {
      icon: Shield,
      title: 'Secure & Private',
      copy: 'Your files and results are stored securely and never shared with others.',
    },
    {
      icon: BarChart3,
      title: 'Track History',
      copy: 'View your past checks and monitor similarity history over time.',
    },
  ];
  const reportRows = [
    { icon: FileText, label: 'Matched Lines', value: '186' },
    { icon: FileArchive, label: 'Matched Files', value: '5 / 14' },
    { icon: Code2, label: 'Possible Copied Logic', value: 'Detected' },
    { icon: Search, label: 'Renamed Variables', value: 'Detected' },
  ];

  function scrollToFeatures() {
    document.getElementById('landing-features')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function navigateFromHeader(item) {
    if (item === 'Features' || item === 'How It Works') {
      scrollToFeatures();
      return;
    }
    if (item === 'Home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const codeSheetLines = [
    'const tokens = normalize(source);',
    'compareTree(astA, astB);',
    'score.semantic = cosine(v1, v2);',
    'flag renamed identifiers;',
    'return evidenceReport;',
  ];

  return (
    <main className="landing-page" id="landing-home">
      <header className="landing-header">
        <div className="landing-header-inner">
          <div className="landing-brand">
            <img className="landing-logo-mark" src="/logo.png" alt="CodeGuard AI logo" />
            <div>
              <strong>{systemBrandName}</strong>
              <small>{systemTagline}</small>
            </div>
          </div>

          <nav className="landing-menu" aria-label="Landing navigation">
            {navItems.map((item) => (
              <button
                key={item}
                className={item === 'Home' ? 'active' : ''}
                type="button"
                onClick={() => navigateFromHeader(item)}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="landing-header-actions">
            <button className="landing-login" type="button" onClick={onEnter}>
              Log In
            </button>
            <button className="landing-start" type="button" onClick={onEnter}>
              Get Started
            </button>
          </div>
        </div>
      </header>

      <section className="integrity-hero">
        <div className="integrity-copy">
          <h1>
            <span>Ensure Originality.</span>
            <span>Promote Integrity.</span>
          </h1>
          <p>
            {systemBrandName} helps educators and institutions detect plagiarism and copied logic in
            programming submissions with detailed similarity analysis.
          </p>

          <div className="integrity-actions">
            <button className="upload-cta" type="button" onClick={onEnter}>
              <UploadCloud size={22} />
              Upload Your Code
            </button>
            <button className="learn-cta" type="button" onClick={scrollToFeatures}>
              Learn More
              <ChevronDown size={20} />
            </button>
          </div>

          <div className="integrity-badges" aria-label="System highlights">
            {trustMarks.map(({ icon: Icon, label }) => (
              <span key={label}>
                <Icon size={22} />
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="report-stage" aria-label="Similarity report preview">
          <div className="paper-stack paper-stack-one" aria-hidden="true" />
          <div className="paper-stack paper-stack-two" aria-hidden="true" />
          <div className="code-sheet" aria-hidden="true">
            {codeSheetLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
          <article className="report-paper">
            <span className="paper-clip" aria-hidden="true" />
            <h2>SIMILARITY REPORT</h2>
            <div className="report-rule" />
            <div className="report-score-row">
              <div className="report-score-copy">
                <span>Similarity Score</span>
                <strong>42%</strong>
                <em>Moderate Similarity</em>
              </div>
              <div className="landing-donut" aria-label="42 percent similarity">
                <span>42%</span>
              </div>
            </div>
            <div className="report-metrics">
              {reportRows.map(({ icon: Icon, label, value }) => (
                <div className="report-metric-row" key={label}>
                  <Icon size={22} />
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <button className="report-preview-button" type="button" onClick={onEnter}>
              View Full Report
            </button>
          </article>
        </div>
      </section>

      <section className="landing-features" id="landing-features">
        <h2>Powerful Features for Academic Integrity</h2>
        <div className="feature-heading-rule" aria-hidden="true" />
        <div className="feature-strip">
          {featureCards.map(({ icon: Icon, title, copy }) => (
            <article key={title}>
              <Icon size={44} strokeWidth={1.8} />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function AuthScreen({ onDemoLogin, onBackendAuth, onBack, role, setRole, isModal = false }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isModal) return undefined;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event) {
      if (event.key === 'Escape') onBack();
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModal, onBack]);

  async function submitAuth(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'register') {
        const data = await requestProfessorAccess({ email, fullName });
        setSuccess(
          data?.message || 'Access request submitted. An administrator will review it before login is enabled.',
        );
        setPassword('');
        return;
      }

      if (!hasSupabaseConfig || !supabase) {
        onDemoLogin(role, email);
        return;
      }

      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        clearApiSession();
      } catch (signInError) {
        if (!shouldUseBackendAuthFallback(signInError)) throw signInError;
        const authPayload = await loginWithBackend({ email, password });
        onBackendAuth(authPayload);
      }
    } catch (authError) {
      setError(getReadableAuthError(authError));
    } finally {
      setLoading(false);
    }
  }

  function switchAuthMode(nextMode) {
    setMode(nextMode);
    setError('');
    setSuccess('');
  }

  const visualPanel = (
      <section className="auth-visual" aria-label="System overview">
        <div className="code-panel">
          <div className="code-panel-header">
            <Code2 size={22} />
            <span>{systemBrandName}</span>
          </div>
          <div className="code-lines" aria-hidden="true">
            {[
              'function compare(projectA, projectB) {',
              '  const tokens = normalize(projectA);',
              '  const score = similarity(tokens, projectB);',
              '  return evidence(score);',
              '}',
            ].map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
          <div className="scan-strip" aria-hidden="true" />
        </div>
      </section>
  );

  const formPanel = (
      <section className="auth-card">
        {isModal ? (
          <button className="auth-close-button" onClick={onBack} type="button" aria-label="Close login modal">
            <X size={18} />
          </button>
        ) : (
          <button className="auth-back-button" onClick={onBack} type="button">
            Back to overview
          </button>
        )}
        <div>
          <p className="eyebrow">Professor Access Only</p>
          <h1 id={isModal ? 'auth-modal-title' : undefined}>{systemBrandName}</h1>
          <p className="subtitle">{systemTagline} for instructors reviewing programming submissions.</p>
        </div>

        <div className="segmented-control" aria-label="Authentication mode">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => switchAuthMode('login')}>
            Login
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => switchAuthMode('register')}
          >
            Request Access
          </button>
        </div>

        <form className="auth-form" onSubmit={submitAuth}>
          {mode === 'register' && (
            <label>
              Full name
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Prof. Maria Santos"
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="professor@school.edu"
              autoComplete="username"
              required
            />
          </label>
          {mode === 'login' && (
            <div className="form-field">
              <label htmlFor="auth-password-input">Password</label>
              <div className="password-field">
                <input
                  id="auth-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  minLength={6}
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                </button>
              </div>
            </div>
          )}

          {!hasSupabaseConfig && mode === 'login' && (
            <div className="role-select">
              <button
                type="button"
                className={role === 'User' ? 'selected' : ''}
                onClick={() => setRole('User')}
              >
                <UserRound size={16} />
                Professor
              </button>
              <button
                type="button"
                className={role === 'Admin' ? 'selected' : ''}
                onClick={() => setRole('Admin')}
              >
                <Shield size={16} />
                Admin
              </button>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}

          <button className="primary-button" type="submit" disabled={loading}>
            {mode === 'login' ? <Lock size={18} /> : <Send size={18} />}
            {loading ? (mode === 'login' ? 'Checking...' : 'Submitting...') : mode === 'login' ? 'Login' : 'Submit access request'}
          </button>
        </form>

        {mode === 'register' && (
          <p className="demo-note">
            Access is intended for professors and authorized instructors only. Use your institutional email address.
          </p>
        )}

        {!hasSupabaseConfig && (
          <p className="demo-note">Local sign-in is enabled until production Supabase keys are set.</p>
        )}
      </section>
  );

  if (isModal) {
    return (
      <div className="auth-modal-shell" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <button className="auth-modal-scrim" type="button" aria-label="Close login modal" onClick={onBack} />
        <div className="auth-modal-panel">
          {visualPanel}
          {formPanel}
        </div>
      </div>
    );
  }

  return (
    <main className="auth-page">
      {visualPanel}
      {formPanel}
    </main>
  );
}

function Sidebar({ activeView, setActiveView, isAdmin, role, user, onLogout }) {
  const displayName = getDisplayName(user);
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload', label: 'Upload Project', icon: UploadCloud },
    { id: 'submissions', label: 'Submission Repository', icon: Folder },
    { id: 'comparisons', label: 'Comparison History', icon: BarChart3 },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'logs', label: 'Activity Logs', icon: Clock3 },
  ];

  const adminItems = [
    ...(isAdmin ? [{ id: 'admin', label: 'Professor Accounts', icon: UsersRound }] : []),
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <img className="brand-mark" src="/logo.png" alt="CodeGuard AI logo" />
        <div>
          <strong>{systemBrandName}</strong>
          <span>AI-integrated similarity review workspace</span>
        </div>
      </div>

      <nav className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={activeView === item.id ? 'active' : ''}
              onClick={() => setActiveView(item.id)}
              title={item.label}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <nav className="nav-list admin-nav">
        {adminItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={activeView === item.id ? 'active' : ''}
              onClick={() => setActiveView(item.id)}
              title={item.label}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-user">
        <div className="avatar">{initialsFromName(displayName) || 'U'}</div>
        <div>
          <strong>{displayName}</strong>
          <span>{role === 'Admin' ? 'Administrator' : user.email}</span>
        </div>
        <button onClick={onLogout} title="Logout">
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}

function Topbar({ role, user, dashboard, accessRequests = [], activeView, setActiveView, onOpenReport, onLogout }) {
  const [open, setOpen] = useState(false);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationRef = useRef(null);
  const sidebarCloseTimer = useRef(null);
  const isDashboard = activeView === 'dashboard';
  const displayName = dashboard?.profile?.displayName || getDisplayName(user);
  const notifications = useMemo(
    () => buildHeaderNotifications({ dashboard, accessRequests, role }),
    [dashboard, accessRequests, role],
  );
  const mobileNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload', label: 'Upload Project', icon: UploadCloud },
    { id: 'submissions', label: 'Submission Repository', icon: Folder },
    { id: 'comparisons', label: 'Comparison History', icon: BarChart3 },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'logs', label: 'Activity Logs', icon: Clock3 },
    ...(role === 'Admin' ? [{ id: 'admin', label: 'Professor Accounts', icon: UsersRound }] : []),
    { id: 'settings', label: 'Settings', icon: Settings },
  ];
  const notificationStorageKey = useMemo(() => notificationSeenStorageKeyForUser(user), [user]);
  const [seenNotificationState, setSeenNotificationState] = useState(() =>
    loadSeenNotificationState(notificationStorageKey),
  );
  const unreadNotificationCount = notifications.filter((item) => !notificationIsSeen(item, seenNotificationState)).length;

  useEffect(() => {
    setSeenNotificationState(loadSeenNotificationState(notificationStorageKey));
  }, [notificationStorageKey]);

  useEffect(
    () => () => {
      if (sidebarCloseTimer.current) window.clearTimeout(sidebarCloseTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return undefined;

    function closeOnEscape(event) {
      if (event.key === 'Escape') closeMobileSidebar();
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (!notificationRef.current?.contains(event.target)) {
        setNotificationsOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') setNotificationsOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationsOpen]);

  function openNotification(item) {
    markNotificationsSeen();
    setNotificationsOpen(false);
    if (item?.type === 'access_request') {
      setActiveView('admin');
      return;
    }
    if (item?.reportId) {
      onOpenReport?.(item.reportId);
      return;
    }
    setActiveView('comparisons');
  }

  function markNotificationsSeen() {
    if (!notifications.length) return;
    const nextSeen = new Set(seenNotificationState.keys);
    notifications.forEach((item) => nextSeen.add(notificationSeenKey(item)));
    const nextState = { keys: nextSeen, seenAt: Date.now() };
    setSeenNotificationState(nextState);
    saveSeenNotificationState(notificationStorageKey, nextState);
  }

  function openMobileSidebar() {
    if (sidebarCloseTimer.current) window.clearTimeout(sidebarCloseTimer.current);
    setSidebarClosing(false);
    setNotificationsOpen(false);
    setOpen(true);
  }

  function closeMobileSidebar() {
    if (!open || sidebarClosing) return;
    setSidebarClosing(true);
    if (sidebarCloseTimer.current) window.clearTimeout(sidebarCloseTimer.current);
    sidebarCloseTimer.current = window.setTimeout(() => {
      setOpen(false);
      setSidebarClosing(false);
      sidebarCloseTimer.current = null;
    }, 230);
  }

  function toggleMobileSidebar() {
    if (open) {
      closeMobileSidebar();
      return;
    }
    openMobileSidebar();
  }

  return (
    <header className="topbar">
      <div>
        <h2>{viewTitle(activeView)}</h2>
        {isDashboard && (
          <p>{displayName}, here is the current submission review queue.</p>
        )}
      </div>
      <div className="topbar-actions">
        <button
          className="icon-button mobile-only"
          aria-expanded={open && !sidebarClosing}
          aria-haspopup="dialog"
          onClick={toggleMobileSidebar}
        >
          <Menu size={20} />
        </button>
        <span className="date-pill">
          <CalendarDays size={18} />
          {formatLongDate(dashboard?.generatedAt)}
        </span>
        <div className="notification-wrap" ref={notificationRef}>
          <button
            className="icon-button notification-button"
            title={unreadNotificationCount ? `Show ${unreadNotificationCount} notifications` : 'Show notifications'}
            aria-label={unreadNotificationCount ? `Show ${unreadNotificationCount} notifications` : 'Show notifications'}
            aria-expanded={notificationsOpen}
            aria-haspopup="dialog"
            onClick={() => {
              closeMobileSidebar();
              markNotificationsSeen();
              setNotificationsOpen((value) => !value);
            }}
          >
            <Bell size={20} />
            {unreadNotificationCount > 0 && <span>{unreadNotificationCount}</span>}
          </button>

          {notificationsOpen && (
            <div className="notification-popover" role="dialog" aria-label="Notifications">
              <div className="notification-panel-header">
                <div>
                  <strong>Notifications</strong>
                  <span>
                    {unreadNotificationCount
                      ? `${unreadNotificationCount} need review`
                      : notifications.length
                        ? 'No new notifications'
                        : 'All clear'}
                  </span>
                </div>
                <button className="icon-button" type="button" onClick={() => setNotificationsOpen(false)}>
                  <X size={17} />
                </button>
              </div>

              <div className="notification-list">
                {notifications.length ? (
                  notifications.map((item) => {
                    const Icon = item.type === 'access_request' ? UsersRound : item.score >= 70 ? AlertTriangle : CheckCircle2;
                    return (
                      <article className="notification-item" key={item.id}>
                        <div className={item.score >= 70 || item.type === 'access_request' ? 'notification-mark high' : 'notification-mark'}>
                          <Icon size={17} />
                        </div>
                        <div className="notification-copy">
                          <strong>{item.title}</strong>
                          <span>{item.message}</span>
                          <small>{formatDateTime(item.date)}</small>
                        </div>
                        <button
                          className="notification-view-button"
                          type="button"
                          onClick={() => openNotification(item)}
                        >
                          View
                        </button>
                      </article>
                    );
                  })
                ) : (
                  <div className="notification-empty">
                    <CheckCircle2 size={20} />
                    <span>No notifications right now.</span>
                  </div>
                )}
              </div>

              <button
                className="notification-history-button"
                type="button"
                onClick={() => {
                  markNotificationsSeen();
                  setNotificationsOpen(false);
                  setActiveView('comparisons');
                }}
              >
                Open comparison history
              </button>
            </div>
          )}
        </div>
        <button className="icon-button top-logout" onClick={onLogout} title={`Logout ${user.email}`}>
          <LogOut size={18} />
        </button>
      </div>

      {open && (
        <div
          className={`mobile-sidebar-shell ${sidebarClosing ? 'closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
        >
          <button className="mobile-sidebar-scrim" type="button" aria-label="Close menu" onClick={closeMobileSidebar} />
          <aside className="mobile-sidebar">
            <div className="mobile-sidebar-header">
              <div className="brand-lockup">
                <img className="brand-mark" src="/logo.png" alt="CodeGuard AI logo" />
                <div>
                  <strong>{systemBrandName}</strong>
                  <span>AI-integrated similarity review workspace</span>
                </div>
              </div>
              <button className="icon-button" type="button" onClick={closeMobileSidebar} aria-label="Close menu">
                <X size={18} />
              </button>
            </div>

            <nav className="nav-list mobile-sidebar-nav">
              {mobileNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={activeView === item.id ? 'active' : ''}
                    onClick={() => {
                      setActiveView(item.id);
                      closeMobileSidebar();
                    }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="sidebar-user mobile-sidebar-user">
              <div className="avatar">{initialsFromName(displayName) || 'U'}</div>
              <div>
                <strong>{displayName}</strong>
                <span>{role === 'Admin' ? 'Administrator' : user.email}</span>
              </div>
              <button
                onClick={() => {
                  closeMobileSidebar();
                  onLogout();
                }}
                title="Logout"
              >
                <LogOut size={17} />
              </button>
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}

function buildHeaderNotifications({ dashboard, accessRequests = [], role }) {
  const recentChecks = dashboard?.recentChecks || [];
  const topMatches = dashboard?.topMatches || [];
  const entries = new Map();

  if (role === 'Admin') {
    accessRequests
      .filter((request) => request.status === 'Pending')
      .slice(0, 5)
      .forEach((request) => {
        entries.set(`access-${request.id}`, {
          id: `access-${request.id}`,
          type: 'access_request',
          title: 'Professor access request',
          score: 100,
          date: request.createdAt,
          message: `${request.name || request.email} is waiting for account review`,
        });
      });
  }

  recentChecks.forEach((check, index) => {
    const score = Number(check.score || 0);
    entries.set(check.reportId || check.id || `recent-${index}`, {
      id: check.reportId || check.id || `recent-${index}`,
      reportId: check.reportId || check.id,
      title: check.project || 'Similarity check',
      score,
      date: check.checkedOn,
      message: `${statusFromScore(score)} result at ${score.toFixed(1)}% similarity`,
    });
  });

  topMatches.forEach((match, index) => {
    const score = Number(match.score || 0);
    const id = match.reportId || match.id || `match-${index}`;
    if (entries.has(id)) return;
    entries.set(id, {
      id,
      reportId: match.reportId || match.id,
      title: match.name || 'Matched submission',
      score,
      date: match.checkedOn || dashboard?.generatedAt,
      message: `${score.toFixed(1)}% top match`,
    });
  });

  const items = Array.from(entries.values());
  const flagged = items.filter((item) => item.score >= 70);
  return (flagged.length ? flagged : items).slice(0, 7);
}

function notificationSeenStorageKeyForUser(user) {
  const identity = String(user?.id || user?.email || 'anonymous').toLowerCase();
  const safeIdentity = identity.replace(/[^a-z0-9_-]/g, '_').slice(0, 96) || 'anonymous';
  return `${seenNotificationStorageKey}:${safeIdentity}`;
}

function notificationSeenKey(item) {
  return `${item.id}:${Number(item.score || 0).toFixed(1)}`;
}

function notificationIsSeen(item, seenState) {
  if (seenState.keys.has(notificationSeenKey(item))) return true;

  const itemTime = Date.parse(item.date || '');
  return Boolean(seenState.seenAt && Number.isFinite(itemTime) && itemTime <= seenState.seenAt);
}

function loadSeenNotificationState(storageKey) {
  try {
    const scopedValue = localStorage.getItem(storageKey);
    const scopedState = parseSeenNotificationState(scopedValue);
    if (scopedState.keys.size || scopedState.seenAt) return scopedState;

    return parseSeenNotificationState(localStorage.getItem(seenNotificationStorageKey));
  } catch {
    return emptySeenNotificationState();
  }
}

function saveSeenNotificationState(storageKey, seenState) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        keys: Array.from(seenState.keys).slice(-200),
        seenAt: seenState.seenAt || 0,
      }),
    );
    localStorage.removeItem(seenNotificationStorageKey);
  } catch {
    // Ignore storage failures; the badge still clears for this session.
  }
}

function parseSeenNotificationState(value) {
  if (!value) return emptySeenNotificationState();

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return { keys: new Set(parsed.filter(Boolean).map(String)), seenAt: Date.now() };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        keys: new Set(Array.isArray(parsed.keys) ? parsed.keys.filter(Boolean).map(String) : []),
        seenAt: Number(parsed.seenAt || 0),
      };
    }
  } catch {
    // Old versions stored a pipe-delimited signature. Parse it below.
  }

  return {
    keys: new Set(
      String(value)
        .split('|')
        .slice(1)
        .map((item) => {
          const [id, score] = item.split(':');
          return id ? `${id}:${Number(score || 0).toFixed(1)}` : '';
        })
        .filter(Boolean),
    ),
    seenAt: Date.now(),
  };
}

function emptySeenNotificationState() {
  return { keys: new Set(), seenAt: 0 };
}

function viewTitle(view) {
  const titles = {
    dashboard: 'Dashboard',
    upload: 'Project Upload',
    history: 'Similarity History',
    projects: 'Submission Repository',
    submissions: 'Submission Repository',
    checks: 'Comparison History',
    comparisons: 'Comparison History',
    reports: 'Reports',
    report: 'Similarity Report',
    logs: 'Activity Logs',
    admin: 'Professor Accounts',
    settings: 'Settings',
  };
  return titles[view] || 'Dashboard';
}

function UserDashboard({ dashboard, loading, onNavigate, onOpenReport, onOpenReportById }) {
  const metrics = useMemo(() => decorateMetrics(normalizeDashboardMetrics(dashboard)), [dashboard]);

  return (
    <div className="dashboard-page">
      {loading && <div className="sync-strip">Syncing dashboard data...</div>}
      <MetricGrid
        metrics={metrics}
        onMetricClick={(metric) => {
          const target = dashboardMetricTarget(metric.label);
          if (target) onNavigate?.(target);
        }}
      />

      <div className="dashboard-analytics-grid">
        <SimilarityOverview data={dashboard?.trend || []} />
        <SimilarityDistribution data={dashboard?.distribution || []} />
      </div>

      <div className="dashboard-bottom-grid">
        <RecentSimilarityChecks checks={dashboard?.recentChecks || []} onOpenReport={onOpenReportById} />
        <TopMatchedProjects projects={dashboard?.topMatches || []} onOpenReport={onOpenReportById || onOpenReport} />
      </div>

      <DashboardFooter />
    </div>
  );
}

function normalizeDashboardMetrics(dashboard) {
  const metrics = dashboard?.metrics || [];
  const recentChecks = dashboard?.recentChecks || [];
  const topMatches = dashboard?.topMatches || [];
  const projectMetric = metrics.find((metric) => String(metric.label || '').toLowerCase().includes('project'));
  const projectCount = Number(projectMetric?.value || 0);
  const hasVisibleChecks = recentChecks.length > 0 || topMatches.length > 0;

  return metrics.map((metric) => {
    const label = String(metric.label || '').toLowerCase();
    if (label.includes('completed') && label.includes('check') && projectCount === 0 && !hasVisibleChecks) {
      return {
        ...metric,
        value: 0,
      };
    }

    return metric;
  });
}

function dashboardMetricTarget(label) {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('project')) return 'submissions';
  if (normalized.includes('check')) return 'comparisons';
  if (normalized.includes('similarity')) return 'comparisons';
  if (normalized.includes('review') || normalized.includes('flag')) return 'comparisons';
  if (normalized.includes('approved') || normalized.includes('resubmission')) return 'comparisons';
  return null;
}

function decorateMetrics(metrics) {
  const icons = {
    blue: FileText,
    green: Code2,
    orange: Percent,
    red: AlertTriangle,
  };

  return metrics.map((metric) => {
    const label = String(metric.label || '').toLowerCase();
    const labelIcon = label.includes('approved')
      ? CheckCircle2
      : label.includes('resubmission')
        ? UploadCloud
        : null;

    return {
      ...metric,
      icon: metric.icon || labelIcon || icons[metric.tone] || Gauge,
    };
  });
}

function MetricGrid({ metrics, onMetricClick }) {
  return (
    <section className="metric-grid">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        const target = onMetricClick ? dashboardMetricTarget(metric.label) : null;
        const className = `metric-card ${metric.tone || ''} ${target ? 'metric-card-action' : ''}`;
        const content = (
          <>
            <div className="metric-icon">
              <Icon size={20} />
            </div>
            <div>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
              {metric.note && <small>{metric.note}</small>}
            </div>
          </>
        );

        if (target) {
          return (
            <button
              className={className}
              key={metric.label}
              type="button"
              onClick={() => onMetricClick(metric)}
              title={`Open ${viewTitle(target)}`}
            >
              {content}
            </button>
          );
        }

        return (
          <article className={className} key={metric.label}>
            {content}
          </article>
        );
      })}
    </section>
  );
}

function makeMetrics(projects) {
  const average =
    projects.length === 0
      ? 0
      : Math.round(
          projects.reduce((total, project) => total + Number(project.highestSimilarity || 0), 0) /
            projects.length,
        );
  const flagged = projects.filter((project) => Number(project.highestSimilarity || 0) >= 70).length;

  return [
    {
      label: 'Projects in Review',
      value: projects.length,
      note: 'current workspace',
      icon: FileText,
      tone: 'blue',
    },
    {
      label: 'Completed Checks',
      value: projects.length,
      note: 'available reports',
      icon: Code2,
      tone: 'green',
    },
    {
      label: 'Mean Similarity',
      value: `${average}%`,
      note: 'current list',
      icon: Percent,
      tone: 'orange',
    },
    {
      label: 'Needs Review',
      value: flagged,
      note: '70% and above',
      icon: AlertTriangle,
      tone: 'red',
    },
  ];
}

function SimilarityOverview({ data }) {
  return (
    <section className="panel dashboard-panel overview-panel">
      <div className="panel-heading">
        <h3>Similarity Overview</h3>
        <select aria-label="Similarity overview period" defaultValue="week">
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="term">This Term</option>
        </select>
      </div>
      <LineTrendChart data={data} />
    </section>
  );
}

function SimilarityDistribution({ data }) {
  const total = data.reduce((sum, item) => sum + Number(item.count || 0), 0);
  return (
    <section className="panel dashboard-panel distribution-panel">
      <div className="panel-heading">
        <h3>Similarity Distribution</h3>
      </div>
      <div className="distribution-content">
        <DistributionDonut data={data} total={total} />
        <div className="distribution-legend">
          {data.map((item) => (
            <div className="distribution-row" key={item.label}>
              <span>
                <i style={{ background: item.color }} />
                {item.label}
              </span>
              <strong>
                {item.count} ({item.percent.toFixed(1)}%)
              </strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecentSimilarityChecks({ checks, onOpenReport }) {
  return (
    <section className="panel dashboard-panel recent-panel">
      <div className="panel-heading">
        <h3>Recent Similarity Checks</h3>
        <button className="ghost-button" onClick={() => onOpenReport?.(checks[0]?.reportId || checks[0]?.id)}>
          View All
        </button>
      </div>

      <div className="dashboard-table-wrap">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Uploaded By</th>
              <th>Checked On</th>
              <th>Top Similarity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr key={check.project}>
                <td>
                  <span className="file-cell">
                    <FileText size={16} />
                    <span>{check.project}</span>
                  </span>
                </td>
                <td>{check.owner}</td>
                <td>{formatDateTime(check.checkedOn)}</td>
                <td>
                  <strong>{Number(check.score || 0).toFixed(1)}%</strong>
                </td>
                <td>
                  <StatusPill status={check.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TopMatchedProjects({ projects, onOpenReport }) {
  return (
    <section className="panel dashboard-panel top-matches-panel">
      <div className="panel-heading">
        <h3>Top Matched Projects</h3>
        <button className="ghost-button" onClick={() => onOpenReport?.(projects[0]?.reportId || projects[0]?.id)}>
          View All
        </button>
      </div>

      <div className="top-match-list">
        {projects.map((project) => (
          <article
            className="top-match-item"
            key={`${project.id || project.name}-${project.score}`}
            onClick={() => onOpenReport?.(project.reportId || project.id)}
          >
            <div className="top-match-icon">
              <FileText size={20} />
            </div>
            <div>
              <strong>{project.name}</strong>
              <span>Uploaded by: {project.owner}</span>
            </div>
            <b>{Number(project.score || 0).toFixed(1)}%</b>
          </article>
        ))}
      </div>
    </section>
  );
}

function DashboardFooter() {
  return (
    <footer className="dashboard-footer">
      <p>
        <span>"</span>
        <em>
          Originality is the foundation of knowledge.
          <br />
          - Ensure integrity. Promote excellence.
        </em>
      </p>
      <div>
        <strong>{systemBrandName} &copy; {systemCopyrightYear}</strong>
        <span>{systemTagline}</span>
      </div>
    </footer>
  );
}

function LineTrendChart({ data }) {
  const chartData = data.length ? data : buildClientTrend([]);
  const width = 720;
  const height = 250;
  const padding = { top: 24, right: 24, bottom: 42, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = chartData.map((item, index) => {
    const x = padding.left + (index / Math.max(1, chartData.length - 1)) * chartWidth;
    const y = padding.top + ((100 - item.value) / 100) * chartHeight;
    return { ...item, x, y };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = [
    `${points[0].x},${padding.top + chartHeight}`,
    ...points.map((point) => `${point.x},${point.y}`),
    `${points[points.length - 1].x},${padding.top + chartHeight}`,
  ].join(' ');

  return (
    <div className="line-chart-wrap" aria-label="Weekly similarity line chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padding.top + ((100 - tick) / 100) * chartHeight;
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text x={padding.left - 14} y={y + 4} textAnchor="end">
                {tick}%
              </text>
            </g>
          );
        })}
        {points.map((point) => (
          <line
            key={`x-${point.label}`}
            className="vertical-grid"
            x1={point.x}
            x2={point.x}
            y1={padding.top}
            y2={padding.top + chartHeight}
          />
        ))}
        <polygon points={area} />
        <polyline points={polyline} />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="5" />
            <text className="point-label" x={point.x} y={point.y - 16} textAnchor="middle">
              {point.value}%
            </text>
            <text className="x-label" x={point.x} y={height - 10} textAnchor="middle">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DistributionDonut({ data, total }) {
  let cursor = 0;
  const chartData = data.length
    ? data
    : [{ label: 'No checks yet', count: 1, percent: 100, color: '#d8ccbc' }];
  const stops = chartData
    .map((item) => {
      const start = cursor;
      cursor += item.percent;
      return `${item.color} ${start}% ${cursor}%`;
    })
    .join(', ');

  return (
    <div className="distribution-donut" style={{ background: `conic-gradient(${stops})` }}>
      <div>
        <strong>{total || 0}</strong>
        <span>Total</span>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const className = status.toLowerCase().replaceAll(' ', '-');
  return <span className={`status-pill ${className}`}>{status}</span>;
}

function SettingsView({ user, role, onProfileUpdated }) {
  const [fullName, setFullName] = useState(() => getDisplayName(user));
  const [email, setEmail] = useState(() => user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const signedInEmail = user?.email || '';
  const emailChanged = email.trim().toLowerCase() !== signedInEmail.trim().toLowerCase();
  const passwordChanging = Boolean(newPassword || confirmPassword);
  const requiresCurrentPassword = emailChanged || passwordChanging;

  useEffect(() => {
    setFullName(getDisplayName(user));
    setEmail(user?.email || '');
  }, [user?.id, user?.email, user?.user_metadata?.full_name]);

  async function submitProfileUpdate(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    const cleanFullName = fullName.trim().replace(/\s+/g, ' ');
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanFullName) {
      setError('Full name is required.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    if (passwordChanging && newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    if (passwordChanging && newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (requiresCurrentPassword && !currentPassword) {
      setError('Enter your current password before changing email or password.');
      return;
    }

    setSaving(true);
    try {
      const data = await updateMyProfile({
        fullName: cleanFullName,
        email: cleanEmail,
        currentPassword: currentPassword || undefined,
        newPassword: passwordChanging ? newPassword : undefined,
        confirmPassword: passwordChanging ? confirmPassword : undefined,
      });

      await supabase?.auth.refreshSession().catch(() => null);
      onProfileUpdated?.(data.profile);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Profile updated successfully.');
    } catch (updateError) {
      setError(updateError.message || 'Unable to update profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel dashboard-panel settings-panel">
      <div className="panel-heading">
        <h3>Settings</h3>
        <Settings size={22} />
      </div>

      <div className="settings-content">
        <div className="settings-grid">
          <article>
            <span>Signed in as</span>
            <strong>{signedInEmail}</strong>
          </article>
          <article>
            <span>Role</span>
            <strong>{displayRoleLabel(role)}</strong>
          </article>
          <article>
            <span>Analysis mode</span>
            <strong>Token, structure, and local model checks</strong>
          </article>
        </div>

        <form className="settings-profile-form" onSubmit={submitProfileUpdate}>
          <div className="settings-form-heading">
            <div>
              <h4>Edit profile</h4>
              <p>Update your account information and password for this workspace.</p>
            </div>
            <UserRound size={22} />
          </div>

          <div className="settings-form-grid">
            <label className="form-field">
              Full name
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Prof. Maria Santos"
                autoComplete="name"
                maxLength={120}
                required
              />
            </label>

            <label className="form-field">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="professor@school.edu"
                autoComplete="username"
                required
              />
            </label>
          </div>

          <div className="settings-password-grid">
            <div className="form-field">
              <label htmlFor="settings-current-password">Current password</label>
              <div className="password-field">
                <input
                  id="settings-current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder={requiresCurrentPassword ? 'Required for email/password changes' : 'Required only for sensitive changes'}
                  autoComplete="current-password"
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowCurrentPassword((current) => !current)}
                  aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
                >
                  {showCurrentPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  <span>{showCurrentPassword ? 'Hide' : 'Show'}</span>
                </button>
              </div>
            </div>

            <label className="form-field">
              New password
              <div className="password-field">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Leave blank to keep current password"
                  autoComplete="new-password"
                  minLength={8}
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowNewPassword((current) => !current)}
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                >
                  {showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  <span>{showNewPassword ? 'Hide' : 'Show'}</span>
                </button>
              </div>
            </label>

            <label className="form-field">
              Confirm new password
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat new password"
                autoComplete="new-password"
                minLength={8}
              />
            </label>
          </div>

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}

          <div className="settings-form-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              <CheckCircle2 size={18} />
              {saving ? 'Saving...' : 'Save profile'}
            </button>
            <span>{requiresCurrentPassword ? 'Current password will be verified before saving.' : 'Name changes can be saved without your password.'}</span>
          </div>
        </form>
      </div>
    </section>
  );
}

function UploadWorkspace({ compact = false, onAnalyzed }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [submissionMeta, setSubmissionMeta] = useState({
    studentName: '',
    subject: '',
    section: '',
  });

  function selectFile(nextFile) {
    if (!nextFile) return;
    const lowerName = nextFile.name.toLowerCase();
    const allowed = supportedExtensions.some((extension) => lowerName.endsWith(extension));
    if (!allowed) {
      setMessage('Unsupported file type.');
      setFile(null);
      return;
    }
    setMessage('');
    setFile(nextFile);
  }

  async function analyzeFile() {
    if (!file) {
      setMessage('Select a file first.');
      return;
    }

    setStatus('running');
    setProgress(12);
    setMessage('Uploading project...');

    const interval = window.setInterval(() => {
      setProgress((value) => Math.min(88, value + 9));
    }, 450);

    try {
      const formData = new FormData();
      formData.append('project', file);
      formData.append('title', file.name);
      formData.append('studentName', submissionMeta.studentName);
      formData.append('subject', submissionMeta.subject);
      formData.append('section', submissionMeta.section);

      const data = await apiRequest('/api/projects/analyze', {
        method: 'POST',
        body: formData,
      });

      window.clearInterval(interval);
      setProgress(100);
      setStatus('done');
      setMessage(data.message || 'Analysis completed.');
      onAnalyzed(normalizeProjectFromApi(file, data), normalizeReportFromApi(file, data));
    } catch (error) {
      window.clearInterval(interval);
      setProgress(100);
      setStatus('idle');
      setMessage(error.message || 'Analysis failed. Please check the file and try again.');
    }
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  function handleDropzoneKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  }

  return (
    <section className={compact ? 'panel upload-panel compact' : 'panel upload-panel'}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Project Upload</p>
          <h3>Check source code</h3>
        </div>
        <UploadCloud size={24} />
      </div>

      <div
        className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
        role="button"
        tabIndex={0}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          selectFile(event.dataTransfer.files?.[0]);
        }}
        onClick={openFilePicker}
        onKeyDown={handleDropzoneKeyDown}
      >
        <span className="dropzone-icon" aria-hidden="true">
          <FileCode2 size={34} />
        </span>
        <strong>{file ? file.name : 'Drop project or source file'}</strong>
        <span>{file ? `${formatBytes(file.size)} selected` : supportedExtensions.slice(0, 10).join(', ')}</span>
        <span className="upload-browse-chip">{file ? 'Change selected file' : 'Browse file'}</span>
        <input
          ref={inputRef}
          type="file"
          accept={supportedExtensions.join(',')}
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
      </div>

      <div className="submission-meta-grid">
        <label>
          Student name
          <input
            value={submissionMeta.studentName}
            onChange={(event) =>
              setSubmissionMeta((current) => ({ ...current, studentName: event.target.value }))
            }
            placeholder="James Matthew Dela Torre"
          />
        </label>
        <label>
          Subject
          <input
            value={submissionMeta.subject}
            onChange={(event) => setSubmissionMeta((current) => ({ ...current, subject: event.target.value }))}
            placeholder="Thesis 1"
          />
        </label>
        <label>
          Section
          <input
            value={submissionMeta.section}
            onChange={(event) => setSubmissionMeta((current) => ({ ...current, section: event.target.value }))}
            placeholder="BSCS 4A"
          />
        </label>
      </div>

      {status !== 'idle' && (
        <div className="progress-wrap">
          <div className="progress-label">
            <span>{message}</span>
            <span>{progress}%</span>
          </div>
          <div className="progress-track">
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {message && status === 'idle' && <p className="form-error">{message}</p>}

      <button
        className="primary-button upload-analyze-button"
        onClick={analyzeFile}
        disabled={status === 'running' || !file}
      >
        <Search size={18} />
        {status === 'running' ? 'Analyzing...' : file ? 'Run similarity check' : 'Select a file to continue'}
      </button>
    </section>
  );
}

function normalizeProjectFromApi(file, data) {
  const score = Math.round(data.project?.highestSimilarity ?? data.report?.similarityScore ?? 0);
  return {
    id: data.project?.id || `api-${Date.now()}`,
    title: data.project?.title || file.name,
    owner: data.project?.owner || 'Current User',
    uploadedBy: data.project?.uploadedBy || 'Current User',
    uploadedByEmail: data.project?.uploadedByEmail || '',
    uploadedById: data.project?.uploadedById || '',
    createdAt: new Date().toISOString().slice(0, 10),
    files: data.files?.length || data.project?.files || 1,
    highestSimilarity: score,
    status: data.project?.status || (score >= 70 ? 'Flagged' : 'Cleared'),
    language: data.project?.language || 'Mixed',
    studentName: data.submission?.studentName || data.project?.owner,
    subject: data.submission?.subject,
    section: data.submission?.section,
    reportId: data.project?.reportId || data.report?.id,
    reviewDecision: data.project?.reviewDecision || data.report?.reviewDecision || null,
  };
}

function normalizeReportFromApi(file, data) {
  const report = data.report || data.reports?.[0] || {};
  const score = Math.round(report.similarityScore || 0);
  return {
    id: report.id || `report-${Date.now()}`,
    projectId: report.projectId || data.project?.id,
    projectTitle: report.projectTitle || file.name,
    comparedWith: report.comparedWith || 'Previous submissions',
    submissionCompared: report.submissionCompared || null,
    waiting: Boolean(report.waiting),
    similarityScore: score,
    generatedAt: new Date().toLocaleString(),
    summary: report.summary || buildGeneratedReportSummary(file.name, score),
    chartData: report.chartData || buildSignalChartData(score),
    filePairs: report.filePairs || [],
    matchedSections: report.matchedSections || [],
    renamedVariables: report.renamedVariables || [],
    aiIntegration: report.aiIntegration,
    authorFingerprint: normalizeAuthorFingerprint(report.authorFingerprint),
    reviewDecision: report.reviewDecision || null,
  };
}

function makeLocalAnalysisReport(file) {
  const score = Math.min(96, Math.max(18, Math.round(48 + (file.size % 51))));
  return {
    id: `report-${Date.now()}`,
    projectTitle: file.name,
    comparedWith: 'local review corpus',
    similarityScore: score,
    generatedAt: new Date().toLocaleString(),
    summary: buildGeneratedReportSummary(file.name, score),
    chartData: buildSignalChartData(score),
    filePairs: [],
    matchedSections: [],
    renamedVariables: [],
    authorFingerprint: makeInsufficientAuthorFingerprint(),
  };
}

function buildProjectReportFallback(project) {
  const score = Math.round(Number(project.highestSimilarity || 0));
  return {
    id: project.reportId || project.id,
    projectId: project.id,
    projectTitle: project.title || 'Selected submission',
    comparedWith: 'Unavailable report details',
    submissionCompared: null,
    waiting: false,
    similarityScore: score,
    generatedAt: project.createdAt || new Date().toLocaleString(),
    summary: buildGeneratedReportSummary(project.title || 'Selected submission', score),
    chartData: buildSignalChartData(score),
    filePairs: [],
    matchedSections: [],
    renamedVariables: [],
    authorFingerprint: project.authorFingerprint || null,
    reviewDecision: project.reviewDecision || null,
  };
}

function normalizeAuthorFingerprint(authorFingerprint) {
  if (!authorFingerprint) return null;
  return {
    ...authorFingerprint,
    signals: Array.isArray(authorFingerprint.signals) ? authorFingerprint.signals : [],
  };
}

function makeInsufficientAuthorFingerprint() {
  return {
    feature: 'Code Author Fingerprint Analysis',
    available: false,
    historicalSubmissionCount: 0,
    historicalFileCount: 0,
    authorConsistencyScore: null,
    styleDeviation: 'Insufficient History',
    styleDeviationLevel: 'Insufficient History',
    aiAnalysis:
      'There are not enough previous submissions from this student to build a reliable coding-style fingerprint yet.',
    recommendation: 'Upload more submissions from this student before using author-style consistency as review evidence.',
    signals: [],
  };
}

function buildGeneratedReportSummary(title, score) {
  if (!score) {
    return `${title} has no completed similarity report data yet. Upload or open a completed comparison to view evidence.`;
  }

  return `${title} has a recorded similarity score of ${score}%. Detailed evidence will appear when the completed report is available.`;
}

function buildSignalChartData(score) {
  return [
    { name: 'Exact', value: Math.max(0, Math.round(score - 18)) },
    { name: 'Structure', value: Math.max(0, Math.round(score - 6)) },
    { name: 'Semantic', value: Math.max(0, Math.round(score - 10)) },
    { name: 'Renamed', value: Math.max(0, Math.round(score - 22)) },
  ];
}

const projectSearchFields = ['title', 'owner', 'uploadedBy', 'uploadedByEmail', 'uploadedById', 'language', 'status', 'createdAt'];
const projectSortOptions = [
  { key: 'createdAt', label: 'Newest upload', accessor: 'createdAt', type: 'date' },
  { key: 'title', label: 'Project name', accessor: 'title', type: 'string' },
  { key: 'owner', label: 'Owner', accessor: 'owner', type: 'string' },
  { key: 'uploadedBy', label: 'Uploader', accessor: 'uploadedBy', type: 'string' },
  { key: 'highestSimilarity', label: 'Similarity score', accessor: 'highestSimilarity', type: 'number' },
  { key: 'status', label: 'Status', accessor: 'status', type: 'string' },
  { key: 'language', label: 'Language', accessor: 'language', type: 'string' },
];

const submissionSearchFields = [
  'studentName',
  'title',
  'subject',
  'section',
  'submissionDate',
  'programmingLanguage',
  'uploadStatus',
];
const submissionSortOptions = [
  { key: 'submissionDate', label: 'Newest submission', accessor: 'submissionDate', type: 'date' },
  { key: 'studentName', label: 'Student name', accessor: 'studentName', type: 'string' },
  { key: 'subject', label: 'Subject', accessor: 'subject', type: 'string' },
  { key: 'section', label: 'Section', accessor: 'section', type: 'string' },
  { key: 'fileCount', label: 'File count', accessor: 'fileCount', type: 'number' },
  { key: 'programmingLanguage', label: 'Language', accessor: 'programmingLanguage', type: 'string' },
  { key: 'uploadStatus', label: 'Upload status', accessor: 'uploadStatus', type: 'string' },
];

const comparisonSearchFields = ['submissionA', 'submissionB', 'scanDate', 'similarityScore', 'reviewStatus'];
const comparisonSortOptions = [
  { key: 'scanDate', label: 'Newest scan', accessor: 'scanDate', type: 'date' },
  { key: 'similarityScore', label: 'Similarity score', accessor: 'similarityScore', type: 'number' },
  { key: 'reviewStatus', label: 'Review status', accessor: 'reviewStatus', type: 'string' },
  { key: 'submissionA', label: 'Submission A', accessor: 'submissionA', type: 'string' },
  { key: 'submissionB', label: 'Submission B', accessor: 'submissionB', type: 'string' },
];

const userSearchFields = ['name', 'email', 'role', 'uploads'];
const userSortOptions = [
  { key: 'name', label: 'Name', accessor: 'name', type: 'string' },
  { key: 'email', label: 'Email', accessor: 'email', type: 'string' },
  { key: 'role', label: 'Role', accessor: 'role', type: 'string' },
  { key: 'uploads', label: 'Uploads', accessor: 'uploads', type: 'number' },
];

const accessRequestSearchFields = ['name', 'email', 'status', 'createdAt'];
const accessRequestSortOptions = [
  { key: 'createdAt', label: 'Newest request', accessor: 'createdAt', type: 'date' },
  { key: 'name', label: 'Professor name', accessor: 'name', type: 'string' },
  { key: 'email', label: 'Email', accessor: 'email', type: 'string' },
  { key: 'status', label: 'Status', accessor: 'status', type: 'string' },
];

function useTableControls(
  rows = [],
  { searchFields, sortOptions, defaultSortKey, defaultDirection = 'desc', defaultPageSize = 8 } = {},
) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(defaultSortKey || sortOptions?.[0]?.key || '');
  const [sortDirection, setSortDirection] = useState(defaultDirection);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    const cleanQuery = normalizeTableText(query);
    if (!cleanQuery) return rows;
    const terms = cleanQuery.split(' ').filter(Boolean);
    return rows.filter((row) => {
      const haystack = normalizeTableText(
        (searchFields || Object.keys(row || {})).map((field) => readTableValue(row, field)).join(' '),
      );
      return terms.every((term) => haystack.includes(term));
    });
  }, [query, rows, searchFields]);

  const sortedRows = useMemo(() => {
    const sortOption = sortOptions?.find((option) => option.key === sortKey) || sortOptions?.[0];
    if (!sortOption) return filteredRows;
    return [...filteredRows].sort((first, second) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      return compareTableValues(readTableValue(first, sortOption.accessor), readTableValue(second, sortOption.accessor), sortOption.type) * direction;
    });
  }, [filteredRows, sortDirection, sortKey, sortOptions]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = sortedRows.length ? (safePage - 1) * pageSize + 1 : 0;
  const endIndex = Math.min(sortedRows.length, safePage * pageSize);
  const visibleRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, sortKey, sortDirection, pageSize, rows.length]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  return {
    query,
    setQuery,
    sortKey,
    setSortKey,
    sortDirection,
    setSortDirection,
    pageSize,
    setPageSize,
    page: safePage,
    setPage,
    totalPages,
    totalCount: rows.length,
    filteredCount: sortedRows.length,
    startIndex,
    endIndex,
    visibleRows,
    sortOptions: sortOptions || [],
  };
}

function TableControls({ table, searchPlaceholder = 'Search records' }) {
  return (
    <div className="table-controls">
      <label className="table-search-field">
        <Search size={17} />
        <input
          value={table.query}
          onChange={(event) => table.setQuery(event.target.value)}
          placeholder={searchPlaceholder}
        />
      </label>

      <label className="table-select-field">
        Sort
        <select value={table.sortKey} onChange={(event) => table.setSortKey(event.target.value)}>
          {table.sortOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        className="secondary-button table-sort-direction"
        type="button"
        onClick={() => table.setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
        title={`Sort ${table.sortDirection === 'asc' ? 'descending' : 'ascending'}`}
      >
        <ArrowUpDown size={17} />
        {table.sortDirection === 'asc' ? 'Asc' : 'Desc'}
      </button>

      <label className="table-select-field compact">
        Rows
        <select value={table.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))}>
          {[5, 8, 10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function TablePagination({ table }) {
  return (
    <div className="table-pagination">
      <span>
        Showing {table.startIndex}-{table.endIndex} of {table.filteredCount}
        {table.filteredCount !== table.totalCount ? ` filtered from ${table.totalCount}` : ''}
      </span>
      <div>
        <button
          className="icon-button"
          type="button"
          onClick={() => table.setPage((current) => Math.max(1, current - 1))}
          disabled={table.page <= 1}
          title="Previous page"
        >
          <ChevronLeft size={18} />
        </button>
        <strong>
          {table.page} / {table.totalPages}
        </strong>
        <button
          className="icon-button"
          type="button"
          onClick={() => table.setPage((current) => Math.min(table.totalPages, current + 1))}
          disabled={table.page >= table.totalPages}
          title="Next page"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function readTableValue(row, field) {
  if (typeof field === 'function') return field(row);
  return row?.[field];
}

function compareTableValues(first, second, type = 'string') {
  if (type === 'number') {
    return Number(first || 0) - Number(second || 0);
  }
  if (type === 'date') {
    return new Date(first || 0).getTime() - new Date(second || 0).getTime();
  }
  return String(first || '').localeCompare(String(second || ''), undefined, { sensitivity: 'base', numeric: true });
}

function normalizeTableText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function HistoryView({ projects, onOpenReport }) {
  return (
    <div className="page-stack">
      <MetricGrid metrics={makeMetrics(projects)} />
      <ProjectTable projects={projects} onOpenReport={onOpenReport} />
    </div>
  );
}

function SubmissionRepository({ submissions }) {
  const table = useTableControls(submissions, {
    searchFields: submissionSearchFields,
    sortOptions: submissionSortOptions,
    defaultSortKey: 'submissionDate',
    defaultDirection: 'desc',
  });

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Submission Repository</p>
          <h3>Stored student submissions</h3>
        </div>
        <Folder size={22} />
      </div>

      <TableControls table={table} searchPlaceholder="Search student, subject, section, language, or status" />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student Name</th>
              <th>Subject</th>
              <th>Section</th>
              <th>Submission Date</th>
              <th>Files</th>
              <th>Programming Language</th>
              <th>Upload Status</th>
            </tr>
          </thead>
          <tbody>
            {table.visibleRows.map((submission) => (
              <tr key={submission.id}>
                <td>
                  <strong>{submission.studentName}</strong>
                  <span>{submission.title}</span>
                </td>
                <td>{submission.subject}</td>
                <td>{submission.section}</td>
                <td>{formatDateTime(submission.submissionDate)}</td>
                <td>{submission.fileCount}</td>
                <td>{submission.programmingLanguage}</td>
                <td>
                  <span className="status ok">{submission.uploadStatus}</span>
                </td>
              </tr>
            ))}
            {table.filteredCount === 0 && (
              <tr>
                <td colSpan={7}>
                  {submissions.length ? 'No submissions match your search.' : 'No submissions uploaded yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination table={table} />
    </section>
  );
}

function ComparisonHistory({ comparisons, onOpenReport, onDeleteComparison }) {
  const table = useTableControls(comparisons, {
    searchFields: comparisonSearchFields,
    sortOptions: comparisonSortOptions,
    defaultSortKey: 'scanDate',
    defaultDirection: 'desc',
  });

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Comparison History</p>
          <h3>Submission-to-submission scans</h3>
        </div>
        <BarChart3 size={22} />
      </div>

      <TableControls table={table} searchPlaceholder="Search submissions, score, or scan date" />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Submission A</th>
              <th>Submission B</th>
              <th>Similarity Score</th>
              <th>Decision</th>
              <th>Scan Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {table.visibleRows.map((comparison) => (
              <tr key={comparison.id}>
                <td>{comparison.submissionA}</td>
                <td>{comparison.submissionB}</td>
                <td>
                  <ScoreBadge score={comparison.similarityScore} />
                </td>
                <td>
                  <span className={`status ${reviewStatusClass(comparison.reviewDecision || comparison.reviewStatus)}`}>
                    {comparison.reviewStatus || reviewDecisionLabel(comparison.reviewDecision) || 'Pending Review'}
                  </span>
                </td>
                <td>{formatDateTime(comparison.scanDate)}</td>
                <td className="row-actions">
                  <button className="icon-button" onClick={() => onOpenReport(comparison.reportId)} title="Open report">
                    <Search size={18} />
                  </button>
                  <button
                    className="icon-button danger-button"
                    onClick={() => onDeleteComparison(comparison.id)}
                    title="Delete comparison"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {table.filteredCount === 0 && (
              <tr>
                <td colSpan={6}>
                  {comparisons.length ? 'No comparisons match your search.' : 'No comparisons yet. Upload at least two submissions.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination table={table} />
    </section>
  );
}

function ProjectTable({ projects, onOpenReport }) {
  const table = useTableControls(projects, {
    searchFields: projectSearchFields,
    sortOptions: projectSortOptions,
    defaultSortKey: 'createdAt',
    defaultDirection: 'desc',
  });

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h3>Similarity checks</h3>
        </div>
        <History size={22} />
      </div>

      <TableControls table={table} searchPlaceholder="Search project, owner, language, status, or date" />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Owner</th>
              <th>Language</th>
              <th>Similarity</th>
              <th>Status</th>
              <th>Report</th>
            </tr>
          </thead>
          <tbody>
            {table.visibleRows.map((project) => (
              <tr key={project.id}>
                <td>
                  <strong>{project.title}</strong>
                  <span>{project.createdAt}</span>
                </td>
                <td>{project.owner}</td>
                <td>{project.language}</td>
                <td>
                  <ScoreBadge score={project.highestSimilarity} />
                </td>
                <td>
                  <span className={`status ${projectStatusClass(project.status)}`}>
                    {project.status}
                  </span>
                </td>
                <td>
                  <button className="icon-button" onClick={() => onOpenReport(project)} title="Open report">
                    <Search size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {table.filteredCount === 0 && (
              <tr>
                <td colSpan={6}>{projects.length ? 'No projects match your search.' : 'No projects uploaded yet.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination table={table} />
    </section>
  );
}

function ReportView({ report, onNavigate, onUpdateDecision }) {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState('');
  const [decisionMessage, setDecisionMessage] = useState('');
  if (!report || isLegacyDemoReport(report)) return <ReportEmptyState onNavigate={onNavigate} />;

  const compared = report.submissionCompared;
  const filePairs = report.filePairs || [];
  const matchedSections = report.matchedSections || [];
  const renamedVariables = report.renamedVariables || [];
  const reviewDecision = report.reviewDecision || null;
  const reviewLabel = reviewDecisionLabel(reviewDecision) || 'Pending Instructor Decision';

  async function applyDecision(decision) {
    if (!onUpdateDecision || !report?.id || decisionLoading) return;

    setDecisionLoading(decision);
    setDecisionMessage('');
    try {
      await onUpdateDecision(report.id, decision);
      setDecisionMessage(
        decision === 'approved'
          ? 'Report marked as approved.'
          : 'Resubmission requested for this report.',
      );
    } catch (error) {
      setDecisionMessage(error.message || 'Unable to update report decision.');
    } finally {
      setDecisionLoading('');
    }
  }

  return (
    <div className="page-stack">
      <section className="report-hero">
        <div>
          <p className="eyebrow">{report.waiting ? 'Submission Indexed' : 'Submission Compared'}</p>
          <h3>{report.waiting ? report.projectTitle : compared ? `${compared.source.title} vs ${compared.compared.title}` : report.projectTitle}</h3>
          {compared && (
            <p className="comparison-heading">
              <strong>Submission Compared:</strong> {compared.source.title} <span>vs</span> {compared.compared.title}
            </p>
          )}
          <p>{report.summary}</p>
        </div>
        <div className="report-hero-side">
          <div className="report-score">
            <span>{report.similarityScore}%</span>
            <small>Similarity</small>
          </div>
          <span className={`status report-decision-badge ${reviewStatusClass(reviewDecision)}`}>
            {reviewLabel}
          </span>
          {!report.waiting && (
            <button className="primary-button report-ai-button" type="button" onClick={() => setIsAssistantOpen(true)}>
              <Bot size={19} />
              AI Chat
            </button>
          )}
        </div>
      </section>

      {!report.waiting && (
        <section className="panel report-decision-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Instructor Decision</p>
              <h3>{reviewLabel}</h3>
            </div>
            <Shield size={22} />
          </div>
          <p className="panel-helper">
            Mark this completed report as approved or request resubmission after manual review.
          </p>
          <div className="report-decision-actions">
            <button
              className="secondary-button decision-approve-button"
              type="button"
              onClick={() => applyDecision('approved')}
              disabled={Boolean(decisionLoading)}
            >
              <CheckCircle2 size={18} />
              {decisionLoading === 'approved' ? 'Saving...' : 'Approve'}
            </button>
            <button
              className="secondary-button decision-resubmit-button"
              type="button"
              onClick={() => applyDecision('resubmit')}
              disabled={Boolean(decisionLoading)}
            >
              <UploadCloud size={18} />
              {decisionLoading === 'resubmit' ? 'Saving...' : 'Request Resubmission'}
            </button>
          </div>
          {reviewDecision?.decidedAt && (
            <p className="decision-meta">
              Last decision by {reviewDecision.decidedBy || 'Instructor'} on {formatDateTime(reviewDecision.decidedAt)}
            </p>
          )}
          {decisionMessage && (
            <p className={decisionMessage.includes('Unable') ? 'form-error' : 'form-success'}>{decisionMessage}</p>
          )}
        </section>
      )}

      {report.aiIntegration && (
        <section className="panel ai-report-panel">
          <div>
            <p className="eyebrow">Semantic Model</p>
            <h3>{report.aiIntegration.model || 'Local semantic model'}</h3>
          </div>
          <div className="ai-report-grid">
            <span>{report.aiIntegration.provider || 'local runtime'}</span>
            <span>{formatAiStatus(report.aiIntegration.status)}</span>
            <span>{report.aiIntegration.fallback || 'rule fallback available'}</span>
          </div>
        </section>
      )}

      {report.authorFingerprint && <AuthorFingerprintPanel analysis={report.authorFingerprint} />}

      {report.waiting && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Repository Status</p>
              <h3>Waiting for another submission to compare.</h3>
            </div>
            <Clock3 size={22} />
          </div>
          <p className="panel-helper">
            This submission was saved and indexed. The next uploaded submission will be compared against it.
          </p>
        </section>
      )}

      {!report.waiting && <div className="report-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Evidence</p>
              <h3>Similarity signals</h3>
            </div>
            <Activity size={22} />
          </div>
          <SignalDonut data={report.chartData} score={report.similarityScore} />
          <div className="legend-grid">
            {(report.chartData || []).map((item, index) => (
              <span key={item.name}>
                <i style={{ background: pieColors[index % pieColors.length] }} />
                {item.name}: {item.value}%
              </span>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Matched Files</p>
              <h3>Suspicious pairs</h3>
            </div>
            <FileCode2 size={22} />
          </div>
          <div className="match-list">
            {filePairs.length ? (
              filePairs.map((pair) => (
                <article key={`${pair.source}-${pair.compared}`} className="match-item">
                  <div>
                    <strong>{pair.source}</strong>
                    <span>{pair.compared}</span>
                    <small>{pair.matchType}</small>
                  </div>
                  <ScoreBadge score={pair.score} />
                </article>
              ))
            ) : (
              <p className="empty-state">No suspicious cross-submission file pairs were found.</p>
            )}
          </div>
        </section>
      </div>}

      {!report.waiting && <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Code Sections</p>
            <h3>Highlighted matches</h3>
          </div>
          <button className="secondary-button" onClick={() => downloadPdf(report)}>
            <Download size={18} />
            PDF
          </button>
        </div>

        {matchedSections.length ? (
          matchedSections.map((section) => (
            <SnippetCompare
              key={`${section.sourceFile}-${section.comparedFile}-${section.sourceLines}`}
              section={section}
            />
          ))
        ) : filePairs.length ? (
          <div className="match-list">
            {filePairs.slice(0, 6).map((pair) => (
              <article className="match-item" key={`evidence-${pair.source}-${pair.compared}`}>
                <div>
                  <strong>{pair.source}</strong>
                  <span>{pair.compared}</span>
                  <small>
                    {pair.matchType || 'Suspicious file pair'} detected. This is file-level evidence; rerun the scan to
                    generate stored line snippets for this pair.
                  </small>
                </div>
                <ScoreBadge score={pair.score || report.similarityScore} />
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            No line-level highlighted matches were found. Review the suspicious file pairs and similarity signals above.
          </p>
        )}
      </section>}

      {!report.waiting && <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Variable Changes</p>
            <h3>Rename indicators</h3>
          </div>
          <Code2 size={22} />
        </div>
        <div className="rename-grid">
          {renamedVariables.length ? (
            renamedVariables.map((item) => (
              <article className="rename-item" key={`${item.from}-${item.to}`}>
                <span>{item.from}</span>
                <strong>{item.to}</strong>
                <ScoreBadge score={item.confidence} />
              </article>
            ))
          ) : (
            <p className="empty-state">No strong variable rename indicators were found for this comparison.</p>
          )}
        </div>
      </section>}

      {isAssistantOpen && (
        <ReportAssistantModal report={report} onClose={() => setIsAssistantOpen(false)} />
      )}
    </div>
  );
}

const reportAssistantActions = [
  { action: 'summarize', label: 'Summarize Report', icon: FileText },
  { action: 'explain_score', label: 'Explain Similarity Score', icon: Percent },
  { action: 'explain_highlights', label: 'Explain Highlighted Code', icon: Code2 },
  { action: 'instructor_notes', label: 'Generate Instructor Notes', icon: NotebookPen },
  { action: 'pdf_summary', label: 'Generate PDF Summary', icon: Download, pdf: true },
];

function ReportAssistantModal({ report, onClose }) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Ask about this completed report only: scores, matched files, highlighted sections, renamed variables, semantic evidence, or author fingerprint analysis.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function sendAssistantRequest({ action, label, makePdf = false, message } = {}) {
    const content = String(message ?? draft).trim();
    const userText = label || content;
    if (!userText || loading) return;

    setDraft('');
    setLoading(true);
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', content: userText },
    ]);

    try {
      const data = await askReportAssistant(report.id, {
        action,
        message: action ? undefined : content,
        history: messages
          .filter((item) => ['user', 'assistant'].includes(item.role) && item.id !== 'welcome')
          .slice(-8)
          .map((item) => ({
            role: item.role,
            content: item.content,
          })),
      });
      const assistant = data.assistant || {};
      const answer = assistant.answer || 'The AI assistant did not return a response for this report.';

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: answer,
          meta: `${assistant.usedAi ? 'AI generated' : 'Report-grounded'} | ${assistant.provider || 'assistant'}`,
        },
      ]);

      if (makePdf) {
        await downloadAssistantSummaryPdf(report, answer);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: error.message || 'Unable to reach the AI Report Assistant right now.',
          meta: 'Assistant error',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    sendAssistantRequest();
  }

  return (
    <div className="assistant-modal-shell" role="dialog" aria-modal="true" aria-label="AI Report Assistant">
      <button className="assistant-modal-scrim" type="button" aria-label="Close AI chat" onClick={onClose} />
      <section className="assistant-modal-panel">
        <header className="assistant-modal-header">
          <div>
            <p className="eyebrow">AI Report Assistant</p>
            <h3>{report.projectTitle}</h3>
          </div>
          <button className="auth-close-button" type="button" onClick={onClose} aria-label="Close AI chat">
            <X size={18} />
          </button>
        </header>

        <div className="assistant-context-strip">
          <span>{report.similarityScore}% similarity</span>
          <span>{report.filePairs?.length || 0} file pairs</span>
          <span>{report.matchedSections?.length || 0} highlighted sections</span>
        </div>

        <div className="assistant-action-grid">
          {reportAssistantActions.map(({ action, label, icon: Icon, pdf }) => (
            <button
              key={action}
              className="secondary-button"
              type="button"
              onClick={() => sendAssistantRequest({ action, label, makePdf: pdf })}
              disabled={loading}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </div>

        <div className="assistant-chat-log" ref={scrollRef}>
          {messages.map((message) => (
            <article className={`assistant-message ${message.role}`} key={message.id}>
              <div className="assistant-message-icon">
                {message.role === 'assistant' ? <Bot size={17} /> : <UserRound size={17} />}
              </div>
              <div>
                <p>{message.content}</p>
                {message.meta && <small>{message.meta}</small>}
              </div>
            </article>
          ))}
          {loading && (
            <article className="assistant-message assistant">
              <div className="assistant-message-icon">
                <Sparkles size={17} />
              </div>
              <div>
                <p>Reading the selected report context and generating an answer...</p>
              </div>
            </article>
          )}
        </div>

        <form className="assistant-input-row" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="assistant-question">
            Ask about this report
          </label>
          <textarea
            id="assistant-question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask why the score is high, which files to review, or what evidence supports the match..."
            rows={2}
            maxLength={900}
          />
          <button className="primary-button" type="submit" disabled={loading || !draft.trim()}>
            <Send size={17} />
            Send
          </button>
        </form>
      </section>
    </div>
  );
}

function AuthorFingerprintPanel({ analysis }) {
  const score =
    analysis.available && Number.isFinite(Number(analysis.authorConsistencyScore))
      ? Math.round(Number(analysis.authorConsistencyScore))
      : null;
  const level = analysis.styleDeviationLevel || analysis.styleDeviation || 'Insufficient History';
  const levelClass = String(level).toLowerCase().replace(/\s+/g, '-');
  const signals = analysis.signals || [];

  return (
    <section className={`panel author-fingerprint-panel ${levelClass}`}>
      <div className="panel-heading author-fingerprint-heading">
        <div>
          <p className="eyebrow">Code Author Fingerprint Analysis</p>
          <h3>{score === null ? 'Needs more student history' : `${score}% Author Consistency`}</h3>
        </div>
        <UserRound size={22} />
      </div>

      <div className="author-fingerprint-summary">
        <div className="author-score-card">
          <strong>{score === null ? '--' : `${score}%`}</strong>
          <span>Author Consistency Score</span>
        </div>

        <div className="author-analysis-copy">
          <div className="author-history-meta">
            <span>{analysis.styleDeviation || 'Insufficient History'}</span>
            <span>{analysis.historicalSubmissionCount || 0} previous submissions</span>
            <span>{analysis.historicalFileCount || 0} historical files</span>
          </div>
          <p>{analysis.aiAnalysis}</p>
          {analysis.recommendation && <small>{analysis.recommendation}</small>}
        </div>
      </div>

      {signals.length ? (
        <div className="style-signal-grid">
          {signals.map((signal) => (
            <article className="style-signal-card" key={signal.key || signal.name}>
              <div>
                <strong>{signal.name}</strong>
                <span>{Math.round(signal.score)}%</span>
              </div>
              <div className="style-signal-track">
                <i style={{ width: `${Math.max(4, Math.min(100, Math.round(signal.score)))}%` }} />
              </div>
              <p>
                Current: {signal.sourceStyle || 'limited evidence'} | History:{' '}
                {signal.historyStyle || 'limited evidence'}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">
          Author fingerprint scoring will appear after this student has previous submissions in the repository.
        </p>
      )}

      <p className="author-advisory">
        Instructor-assist only. This analysis provides evidence and recommendations for manual review and does not
        automatically determine guilt or plagiarism.
      </p>
    </section>
  );
}

function isLegacyDemoReport(report) {
  const title = String(report?.projectTitle || '');
  return report?.id === 'report-local' || title.includes('Week 06 LoginController');
}

function ReportEmptyState({ onNavigate }) {
  return (
    <section className="panel dashboard-panel report-empty-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Reports</p>
          <h3>No report selected</h3>
        </div>
        <FileText size={24} />
      </div>
      <p>
        Reports are generated after a project is analyzed or when you open a completed comparison. No demo evidence is
        shown here.
      </p>
      <div className="report-empty-actions">
        <button className="primary-button" type="button" onClick={() => onNavigate?.('upload')}>
          <UploadCloud size={18} />
          Upload project
        </button>
        <button className="ghost-button" type="button" onClick={() => onNavigate?.('comparisons')}>
          <BarChart3 size={17} />
          Open comparison history
        </button>
      </div>
    </section>
  );
}

function SnippetCompare({ section }) {
  const [expanded, setExpanded] = useState(false);
  const sourceSnippet = formatSnippet(section.sourceSnippet);
  const comparedSnippet = formatSnippet(section.comparedSnippet);
  const shouldCollapse = sourceSnippet.lineCount > 10 || comparedSnippet.lineCount > 10;
  const showFull = expanded || !shouldCollapse;

  return (
    <article className={`snippet-compare ${showFull ? 'expanded' : 'collapsed'}`}>
      <div className="snippet-title">
        <strong>
          {section.sourceFile} lines {section.sourceLines}
        </strong>
        <ScoreBadge score={section.confidence} />
        <strong>
          {section.comparedFile} lines {section.comparedLines}
        </strong>
      </div>

      <pre className="code-snippet">{showFull ? sourceSnippet.full : sourceSnippet.preview}</pre>
      <pre className="code-snippet">{showFull ? comparedSnippet.full : comparedSnippet.preview}</pre>

      {shouldCollapse && (
        <button className="secondary-button snippet-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show less' : 'View all'}
        </button>
      )}
    </article>
  );
}

function formatSnippet(value) {
  const text = String(value || '').trimEnd();
  const lines = text.split(/\r?\n/);
  const previewLines = lines.slice(0, 8);
  const preview = previewLines.join('\n') + (lines.length > previewLines.length ? '\n...' : '');

  return {
    full: text,
    preview,
    lineCount: lines.length,
  };
}

function AdminDashboard({
  projects,
  users,
  accessRequests = [],
  onDeleteProject,
  onOpenReport,
  onChangeUserRole,
  onCreateUser,
  onUpdateAccessRequest,
}) {
  const metrics = makeMetrics(projects);
  const projectTable = useTableControls(projects, {
    searchFields: projectSearchFields,
    sortOptions: projectSortOptions,
    defaultSortKey: 'createdAt',
    defaultDirection: 'desc',
  });
  const userTable = useTableControls(users, {
    searchFields: userSearchFields,
    sortOptions: userSortOptions,
    defaultSortKey: 'name',
    defaultDirection: 'asc',
    defaultPageSize: 5,
  });
  const accessRequestTable = useTableControls(accessRequests, {
    searchFields: accessRequestSearchFields,
    sortOptions: accessRequestSortOptions,
    defaultSortKey: 'createdAt',
    defaultDirection: 'desc',
    defaultPageSize: 5,
  });
  const [newUser, setNewUser] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'user',
  });
  const [selectedAccessRequestId, setSelectedAccessRequestId] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userMessage, setUserMessage] = useState('');
  const pendingAccessRequests = accessRequests.filter((request) => request.status === 'Pending').length;

  function useAccessRequest(accessRequest) {
    setSelectedAccessRequestId(accessRequest.id);
    setNewUser((current) => ({
      ...current,
      fullName: accessRequest.name,
      email: accessRequest.email,
      role: 'user',
    }));
    setUserMessage('Access request loaded. Set a temporary password, then create the professor account.');
  }

  async function submitNewUser(event) {
    event.preventDefault();
    setUserMessage('');
    setCreatingUser(true);
    const createdRoleLabel = newUser.role === 'admin' ? 'Admin' : 'Professor';

    try {
      await onCreateUser(newUser);
      if (selectedAccessRequestId) {
        await onUpdateAccessRequest(selectedAccessRequestId, 'approved');
      }
      setNewUser({
        fullName: '',
        email: '',
        password: '',
        role: 'user',
      });
      setSelectedAccessRequestId('');
      setUserMessage(`${createdRoleLabel} account created. The user can sign in with the assigned temporary password.`);
    } catch (error) {
      setUserMessage(error.message || 'Unable to create user.');
    } finally {
      setCreatingUser(false);
    }
  }

  return (
    <div className="page-stack">
      <MetricGrid metrics={metrics} />

      <div className="admin-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Administration</p>
              <h3>Uploaded projects</h3>
            </div>
            <Shield size={22} />
          </div>
          <TableControls table={projectTable} searchPlaceholder="Search project, owner, uploader, email, language, status, or date" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Student/Owner</th>
                  <th>Uploaded By</th>
                  <th>Similarity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {projectTable.visibleRows.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong>{project.title}</strong>
                      <span>{project.files} files</span>
                    </td>
                    <td>{project.owner}</td>
                    <td className="uploader-cell">
                      <strong title={project.uploadedBy || 'Unknown account'}>{project.uploadedBy || 'Unknown account'}</strong>
                      {project.uploadedByEmail && <span title={project.uploadedByEmail}>{project.uploadedByEmail}</span>}
                      {project.uploadedById && <small title={project.uploadedById}>ID: {project.uploadedById}</small>}
                    </td>
                    <td>
                      <ScoreBadge score={project.highestSimilarity} />
                    </td>
                    <td className="row-actions">
                      <button className="icon-button" onClick={() => onOpenReport(project)} title="Open report">
                        <Search size={18} />
                      </button>
                      <button
                        className="icon-button danger-button"
                        onClick={() => onDeleteProject(project.id)}
                        title="Delete project"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
                {projectTable.filteredCount === 0 && (
                  <tr>
                    <td colSpan={5}>
                      {projects.length ? 'No projects match your search.' : 'No uploaded projects yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePagination table={projectTable} />
        </section>

        <section className="panel access-request-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Professor Access</p>
              <h3>Request queue</h3>
            </div>
            <Clock3 size={22} />
          </div>
          <p className="panel-helper">
            {pendingAccessRequests
              ? `${pendingAccessRequests} pending request${pendingAccessRequests === 1 ? '' : 's'} waiting for review.`
              : 'No pending professor access requests right now.'}
          </p>
          <TableControls table={accessRequestTable} searchPlaceholder="Search requester, email, status, or date" />
          <div className="access-request-list">
            {accessRequestTable.visibleRows.map((accessRequest) => (
              <article className="access-request-row" key={accessRequest.id}>
                <div className="access-request-copy">
                  <strong>{accessRequest.name}</strong>
                  <span>{accessRequest.email}</span>
                  <small>Requested {formatDateTime(accessRequest.createdAt)}</small>
                </div>
                <div className="access-request-actions">
                  <span className={`status ${accessRequest.status === 'Pending' ? 'warning' : accessRequest.status === 'Approved' ? 'ok' : 'danger'}`}>
                    {accessRequest.status}
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => useAccessRequest(accessRequest)}
                    disabled={accessRequest.status !== 'Pending'}
                  >
                    <UsersRound size={17} />
                    Use request
                  </button>
                  <button
                    className="icon-button danger-button"
                    type="button"
                    onClick={() => onUpdateAccessRequest(accessRequest.id, 'rejected')}
                    disabled={accessRequest.status !== 'Pending'}
                    title="Reject request"
                  >
                    <X size={17} />
                  </button>
                </div>
              </article>
            ))}
            {accessRequestTable.filteredCount === 0 && (
              <p className="empty-state">
                {accessRequests.length
                  ? 'No access requests match your search.'
                  : 'No professor access requests have been submitted yet.'}
              </p>
            )}
          </div>
          <TablePagination table={accessRequestTable} />
        </section>

        <section className="panel user-management-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Admin Only</p>
              <h3>Professor accounts</h3>
            </div>
            <UsersRound size={22} />
          </div>
          <p className="panel-helper">Create approved professor accounts and assign dashboard access roles.</p>
          <form className="admin-create-user-form" onSubmit={submitNewUser}>
            <label>
              Full name
              <input
                value={newUser.fullName}
                onChange={(event) => setNewUser((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Prof. Maria Santos"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={newUser.email}
                onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
                placeholder="maria.santos@school.edu"
                required
              />
            </label>
            <label>
              Temporary password
              <input
                type="password"
                value={newUser.password}
                onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </label>
            <label>
              Role
              <select
                value={newUser.role}
                onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value }))}
              >
                <option value="user">Professor</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button className="primary-button admin-create-user-button" type="submit" disabled={creatingUser}>
              <UsersRound size={18} />
              {creatingUser ? 'Creating...' : 'Create user'}
            </button>
          </form>
          {userMessage && (
            <p className={userMessage.includes('created') || userMessage.includes('loaded') ? 'form-success' : 'form-error'}>
              {userMessage}
            </p>
          )}
          <TableControls table={userTable} searchPlaceholder="Search name, email, role, or uploads" />
          <div className="user-list">
            {userTable.visibleRows.map((user) => (
              <article className="user-row" key={user.id}>
                <div className="avatar">{user.name.slice(0, 1)}</div>
                <div className="user-info">
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>
                <div className="user-role-controls">
                  <div className="role-summary">
                    <span className={user.role === 'Admin' ? 'status admin' : 'status ok'}>
                      {displayRoleLabel(user.role)}
                    </span>
                    <small>Current access</small>
                  </div>
                  <label className="role-select-field">
                    <span>Change role</span>
                    <select
                      value={user.role === 'Admin' ? 'admin' : 'user'}
                      aria-label={`Role for ${user.email}`}
                      onChange={(event) => onChangeUserRole(user.id, event.target.value)}
                    >
                      <option value="user">Professor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                </div>
              </article>
            ))}
            {userTable.filteredCount === 0 && (
              <p className="empty-state">
                {users.length ? 'No user accounts match your search.' : 'No user accounts loaded. Sign in as an admin to fetch users.'}
              </p>
            )}
          </div>
          <TablePagination table={userTable} />
        </section>
      </div>
    </div>
  );
}

function ScoreBadge({ score }) {
  const level = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';
  return <span className={`score-badge ${level}`}>{Math.round(score)}%</span>;
}

function MiniBarChart({ data }) {
  return (
    <div className="mini-bar-chart" aria-label="Similarity signal bar chart">
      {data.map((item, index) => (
        <div className="mini-bar" key={item.name}>
          <div className="mini-bar-track">
            <div
              style={{
                height: `${Math.max(4, item.value)}%`,
                background: pieColors[index % pieColors.length],
              }}
            />
          </div>
          <span>{item.name}</span>
          <strong>{item.value}%</strong>
        </div>
      ))}
    </div>
  );
}

function SignalDonut({ data = [], score }) {
  const safeData = data.length ? data : [{ name: 'No Data', value: 1 }];
  const total = safeData.reduce((sum, item) => sum + item.value, 0) || 1;
  let cursor = 0;
  const stops = safeData
    .map((item, index) => {
      const start = (cursor / total) * 100;
      cursor += item.value;
      const end = (cursor / total) * 100;
      const color = pieColors[index % pieColors.length];
      return `${color} ${start}% ${end}%`;
    })
    .join(', ');
  const average = Math.round(safeData.reduce((sum, item) => sum + item.value, 0) / safeData.length);
  const displayScore = Number.isFinite(Number(score)) ? Math.round(Number(score)) : average;

  return (
    <div className="signal-donut-wrap">
      <div className="signal-donut" style={{ background: `conic-gradient(${stops})` }}>
        <div>
          <strong>{displayScore}%</strong>
          <span>Overall</span>
        </div>
      </div>
    </div>
  );
}

async function downloadPdf(report) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(`${systemFullName} Report`, 14, 18);
  doc.setFontSize(11);
  doc.text(`Project: ${report.projectTitle}`, 14, 30);
  doc.text(`Compared with: ${report.comparedWith}`, 14, 38);
  doc.text(`Similarity: ${report.similarityScore}%`, 14, 46);
  doc.text(`Generated: ${report.generatedAt}`, 14, 54);

  const summary = doc.splitTextToSize(report.summary, 180);
  doc.text(summary, 14, 66);

  let cursor = 84;
  if (report.authorFingerprint) {
    const fingerprint = report.authorFingerprint;
    doc.setFontSize(13);
    doc.text('Code Author Fingerprint Analysis', 14, cursor);
    cursor += 8;
    doc.setFontSize(10);
    const score =
      fingerprint.authorConsistencyScore === null || fingerprint.authorConsistencyScore === undefined
        ? 'Insufficient history'
        : `${Math.round(fingerprint.authorConsistencyScore)}%`;
    doc.text(`Author Consistency Score: ${score}`, 14, cursor);
    cursor += 7;
    doc.text(`Style Deviation: ${fingerprint.styleDeviation || 'Insufficient History'}`, 14, cursor);
    cursor += 7;
    const fingerprintLines = doc.splitTextToSize(fingerprint.aiAnalysis || '', 180);
    doc.text(fingerprintLines, 14, cursor);
    cursor += fingerprintLines.length * 6 + 6;
  }

  doc.setFontSize(13);
  doc.text('Suspicious File Pairs', 14, cursor);
  cursor += 8;
  doc.setFontSize(10);

  report.filePairs.slice(0, 8).forEach((pair) => {
    doc.text(`${pair.score}% - ${pair.source} vs ${pair.compared}`, 14, cursor);
    cursor += 7;
  });

  cursor += 4;
  doc.setFontSize(13);
  doc.text('Rename Indicators', 14, cursor);
  cursor += 8;
  doc.setFontSize(10);

  report.renamedVariables.slice(0, 8).forEach((item) => {
    doc.text(`${item.from} -> ${item.to} (${item.confidence}%)`, 14, cursor);
    cursor += 7;
  });

  doc.save(`${report.projectTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_similarity_report.pdf`);
}

async function downloadAssistantSummaryPdf(report, assistantSummary) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(`${systemFullName} AI Report Summary`, 14, 18);
  doc.setFontSize(11);
  doc.text(`Project: ${report.projectTitle}`, 14, 30);
  doc.text(`Similarity: ${report.similarityScore}%`, 14, 38);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 46);

  const lines = doc.splitTextToSize(String(assistantSummary || ''), 180);
  let cursor = 60;
  lines.forEach((line) => {
    if (cursor > 278) {
      doc.addPage();
      cursor = 18;
    }
    doc.text(line, 14, cursor);
    cursor += 6;
  });

  doc.save(`${report.projectTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_ai_summary.pdf`);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

export default App;
