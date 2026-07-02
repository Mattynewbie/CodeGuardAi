export const demoProjects = [
  {
    id: 'proj-auth-api',
    title: 'auth-api-review.zip',
    owner: 'R. Mendoza',
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    files: 24,
    highestSimilarity: 62.4,
    status: 'Flagged',
    language: 'PHP, JavaScript',
    reportId: 'seed-report-auth-api',
  },
  {
    id: 'proj-cart-module',
    title: 'cart-module-final.rar',
    owner: 'M. Santos',
    createdAt: new Date(Date.now() - 33 * 60 * 60 * 1000).toISOString(),
    files: 18,
    highestSimilarity: 23.7,
    status: 'Cleared',
    language: 'Java',
    reportId: 'seed-report-cart-module',
  },
  {
    id: 'proj-student-records',
    title: 'student-records-v2.zip',
    owner: 'M. Aquino',
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    files: 31,
    highestSimilarity: 84.3,
    status: 'Flagged',
    language: 'PHP, CSS, SQL',
    reportId: 'seed-report-student-records',
  },
];

export const demoUsers = [
  { id: 'usr-001', name: 'J. Dela Torre', email: 'instructor@scsd.local', role: 'Admin', uploads: 17 },
  { id: 'usr-002', name: 'R. Mendoza', email: 'rmendoza@scsd.local', role: 'User', uploads: 4 },
  { id: 'usr-003', name: 'M. Santos', email: 'msantos@scsd.local', role: 'User', uploads: 3 },
];
