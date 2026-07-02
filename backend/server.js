import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { config } from './src/config.js';
import { getAiRuntimeInfo } from './src/services/ai.js';
import { answerReportQuestion, getReportAssistantRuntimeInfo } from './src/services/reportAssistant.js';
import { extractUpload } from './src/services/archive.js';
import { analyzeSubmission, toSourceDocument } from './src/services/analyzer.js';
import { buildReport, buildWaitingReport } from './src/services/report.js';
import {
  ApiError,
  createAdminUser,
  deleteComparisonById,
  deleteProjectById,
  fetchAccessRequests,
  fetchAdminUsers,
  fetchComparisonHistory,
  fetchComparisonCorpus,
  fetchDashboardData,
  fetchProjectList,
  fetchReportById,
  fetchSubmissionRepository,
  identifyRequestUser,
  loginUser,
  persistAnalysis,
  requestProfessorAccess,
  updateReportDecision,
  updateAccessRequestStatus,
  updateUserRole,
} from './src/services/supabaseStore.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../frontend/dist');
const uploadDir = path.join(os.tmpdir(), 'source-code-checker-uploads');
await fs.mkdir(uploadDir, { recursive: true });
const hasClientBuild = await fs
  .access(clientDist)
  .then(() => true)
  .catch(() => false);

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
  },
  fileFilter(_request, file, callback) {
    const lowerName = file.originalname.toLowerCase();
    const allowed = config.allowedUploadExtensions.some((extension) => lowerName.endsWith(extension));
    if (!allowed) {
      callback(new Error('Unsupported upload type.'));
      return;
    }
    callback(null, true);
  },
});

const authRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (request) => `${request.ip}:${String(request.body?.email || '').trim().toLowerCase() || 'unknown'}`,
});
const registrationRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const mutationRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
const analysisRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8 });
const assistantRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 12 });

const connectSources = [
  "'self'",
  'http://localhost:4100',
  'http://127.0.0.1:4100',
  'http://192.168.1.5:4100',
];

if (config.supabaseUrl) {
  connectSources.push(new URL(config.supabaseUrl).origin);
}

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: connectSources,
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: null,
      },
    },
  }),
);
app.use(
  (request, response, next) => {
    cors({
      origin(origin, callback) {
        if (isAllowedCorsOrigin(origin, request.headers.host)) {
          callback(null, true);
          return;
        }
        callback(new ApiError(403, 'Origin is not allowed.'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    })(request, response, next);
  },
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb', parameterLimit: 50 }));

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'codeguard-ai-api',
    ai: getAiRuntimeInfo(),
  });
});

app.get('/api/ai/status', (_request, response) => {
  response.json({
    similarity: getAiRuntimeInfo(),
    reportAssistant: getReportAssistantRuntimeInfo(),
  });
});

app.post('/api/auth/login', authRateLimit, async (request, response, next) => {
  try {
    const authPayload = await loginUser(request.body || {});
    response.json(authPayload);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register', registrationRateLimit, async (request, response, next) => {
  try {
    throw new ApiError(410, 'Public registration is disabled. Please request professor access instead.');
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/access-request', registrationRateLimit, async (request, response, next) => {
  try {
    const accessRequest = await requestProfessorAccess(request.body || {});
    response.status(201).json({
      accessRequest,
      message: 'Access request submitted. An administrator will review it before login is enabled.',
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard', async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const dashboard = await fetchDashboardData({ user });
    response.json(dashboard);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects', async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const projects = await fetchProjectList({ user });
    response.json({ projects });
  } catch (error) {
    next(error);
  }
});

app.get('/api/submissions', async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const submissions = await fetchSubmissionRepository({ user });
    response.json({ submissions });
  } catch (error) {
    next(error);
  }
});

app.get('/api/comparisons', async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const comparisons = await fetchComparisonHistory({ user });
    response.json({ comparisons });
  } catch (error) {
    next(error);
  }
});

app.get('/api/reports/:id', async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const report = await fetchReportById(request.params.id, { user });

    if (!report) {
      response.status(404).json({ error: 'Report not found.' });
      return;
    }

    response.json({ report });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/reports/:id/decision', mutationRateLimit, async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const report = await updateReportDecision(request.params.id, request.body || {}, { user });
    response.json({ report });
  } catch (error) {
    next(error);
  }
});

app.post('/api/reports/:id/assistant', assistantRateLimit, async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const report = await fetchReportById(request.params.id, { user });

    if (!report) {
      response.status(404).json({ error: 'Report not found.' });
      return;
    }

    const assistantResponse = await answerReportQuestion({
      report,
      message: request.body?.message,
      action: request.body?.action,
      history: request.body?.history,
    });

    response.json({ assistant: assistantResponse });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/comparisons/:id', mutationRateLimit, async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const deleted = await deleteComparisonById(request.params.id, { user });

    if (!deleted) {
      response.status(404).json({ error: 'Comparison not found.' });
      return;
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:id', mutationRateLimit, async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const deleted = await deleteProjectById(request.params.id, { user });

    if (!deleted) {
      response.status(404).json({ error: 'Project not found.' });
      return;
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const users = await fetchAdminUsers({ user });
    response.json({ users });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/access-requests', async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const accessRequests = await fetchAccessRequests({ user });
    response.json({ accessRequests });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users', mutationRateLimit, async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const createdUser = await createAdminUser(request.body || {}, { user });
    response.status(201).json({ user: createdUser });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/access-requests/:id', mutationRateLimit, async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const accessRequest = await updateAccessRequestStatus(request.params.id, request.body?.status, { user });
    response.json({ accessRequest });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/users/:id/role', mutationRateLimit, async (request, response, next) => {
  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const updatedUser = await updateUserRole(request.params.id, request.body?.role, { user });
    response.json({ user: updatedUser });
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/analyze', analysisRateLimit, upload.single('project'), async (request, response, next) => {
  const uploadedFile = request.file;
  if (!uploadedFile) {
    response.status(400).json({ error: 'No project file uploaded.' });
    return;
  }

  try {
    const user = await identifyRequestUser(request.headers.authorization);
    const extractedFiles = await extractUpload(uploadedFile);

    if (extractedFiles.length === 0) {
      response.status(400).json({ error: 'No supported source files were found.' });
      return;
    }

    const projectId = crypto.randomUUID();
    const projectTitle = cleanField(request.body.title, 160) || cleanField(uploadedFile.originalname, 160) || 'Uploaded project';
    const sourceSubmission = {
      id: projectId,
      title: projectTitle,
      studentName: cleanField(request.body.studentName, 120) || user?.fullName || user?.email || 'Student',
      subject: cleanField(request.body.subject, 120) || 'Unassigned',
      section: cleanField(request.body.section, 80) || 'Unassigned',
      submittedAt: new Date().toISOString(),
    };
    const sourceDocuments = extractedFiles.map((file) =>
      toSourceDocument({
        ...file,
        projectId,
        ownerId: user?.id ?? null,
        projectTitle,
      }),
    );

    const corpus = await fetchComparisonCorpus({ user });
    const analysis = await analyzeSubmission(sourceDocuments, corpus, { sourceSubmission });
    const reports = analysis.comparisons.map((comparison) =>
      buildReport({
        projectId,
        projectTitle,
        sourceSubmission,
        comparedSubmission: comparison.comparedSubmission,
        sourceDocuments,
        comparison,
        authorFingerprint: analysis.authorFingerprint,
      }),
    );
    const report =
      reports[0] ||
      buildWaitingReport({
        projectId,
        projectTitle,
        sourceSubmission,
        sourceDocuments,
        authorFingerprint: analysis.authorFingerprint,
      });

    const persisted = await persistAnalysis({
      user,
      uploadedFile,
      sourceDocuments,
      sourceSubmission,
      analysis,
      reports,
    });

    response.json({
      project: {
        id: persisted.projectId || projectId,
        title: projectTitle,
        owner: sourceSubmission.studentName,
        files: sourceDocuments.length,
        language: summarizeLanguages(sourceDocuments),
        highestSimilarity: analysis.projectScore || 0,
        status: reports.length ? (analysis.projectScore >= 70 ? 'Flagged' : 'Cleared') : 'Indexed',
        reportId: reports[0]?.id || null,
      },
      submission: {
        ...sourceSubmission,
        fileCount: sourceDocuments.length,
        language: summarizeLanguages(sourceDocuments),
        uploadStatus: 'Completed',
      },
      files: sourceDocuments.map((document) => ({
        path: document.filePath,
        language: document.language,
        sizeBytes: document.sizeBytes,
      })),
      waiting: reports.length === 0,
      message: reports.length === 0 ? 'Waiting for another submission to compare.' : 'Analysis completed.',
      report,
      reports,
    });
  } catch (error) {
    next(error);
  } finally {
    await fs.rm(uploadedFile.path, { force: true }).catch(() => {});
  }
});

if (hasClientBuild) {
  app.use(express.static(clientDist));
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/')) {
      next();
      return;
    }
    response.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found.' });
});

app.use((error, _request, response, _next) => {
  const status = statusFromError(error);
  if (status >= 500) {
    console.error('Unhandled API error:', error?.message || error);
  }

  response.status(status).json({
    error: publicErrorMessage(error, status),
  });
});

function summarizeLanguages(documents) {
  const counts = new Map();
  for (const document of documents) {
    counts.set(document.language, (counts.get(document.language) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([language]) => language)
    .join(', ');
}

function cleanField(value, maxLength = 160) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function createRateLimiter({ windowMs, max, key = (request) => request.ip }) {
  const buckets = new Map();

  return (request, response, next) => {
    const now = Date.now();
    const bucketKey = `${request.method}:${request.path}:${key(request)}`;
    const recentHits = (buckets.get(bucketKey) || []).filter((hitTime) => now - hitTime < windowMs);

    if (recentHits.length >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - recentHits[0])) / 1000));
      response.setHeader('Retry-After', String(retryAfterSeconds));
      response.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
      return;
    }

    recentHits.push(now);
    buckets.set(bucketKey, recentHits);
    next();
  };
}

function isAllowedCorsOrigin(origin, requestHost) {
  if (!origin) return true;
  if (config.corsOrigins === false) return false;
  if (Array.isArray(config.corsOrigins) && config.corsOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    if (requestHost && url.host === requestHost) return true;

    const isDevelopment = process.env.NODE_ENV !== 'production';
    const host = url.hostname;
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const isPrivateLan = /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    return isDevelopment && (isLoopback || isPrivateLan);
  } catch {
    return false;
  }
}

function statusFromError(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (error?.code === 'LIMIT_FILE_SIZE') return 413;
  if (error?.code?.startsWith?.('LIMIT_')) return 400;
  if (error?.message?.includes('Unsupported')) return 400;
  return 500;
}

function publicErrorMessage(error, status) {
  if (status >= 500) return 'Unexpected server error.';
  if (error?.code === 'LIMIT_FILE_SIZE') return 'Uploaded file exceeds the size limit.';
  return error?.message || 'Request failed.';
}

if (process.env.NODE_ENV !== 'test' && process.env.NODE_TEST_CONTEXT !== 'child-v8') {
  app.listen(config.port, () => {
    console.log(`CodeGuard AI API running on http://localhost:${config.port}`);
  });
}

export { app };
