import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { compareDocuments, isCommonHtmlBoilerplateSnippet, toSourceDocument } from './analyzer.js';

const supabase =
  config.supabaseUrl && config.supabaseServiceRoleKey
    ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;
const sourceTextDecoder = new TextDecoder('utf-8', { fatal: false });
const htmlBoilerplateOnlySummary = 'Only common HTML boilerplate was matched. No meaningful plagiarism evidence found.';

export const isSupabaseConfigured = Boolean(supabase);

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function loginUser({ email, password } = {}) {
  const { normalizedEmail, cleanPassword } = validateAuthInput({ email, password });

  if (!supabase) {
    throw new ApiError(503, 'Supabase is not configured.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: cleanPassword,
  });

  if (error) {
    throw new ApiError(error.status || 401, normalizeAuthMessage(error.message));
  }

  const profile = await ensureUserProfile(data.user);
  return toAuthResponse(data, profile);
}

const seedProjects = [
  {
    id: 'seed-auth-api',
    title: 'auth-api-review.zip',
    owner: 'R. Mendoza',
    createdAt: daysAgo(1, 10, 30),
    files: 24,
    highestSimilarity: 62.4,
    status: 'High',
    language: 'PHP, JavaScript',
    reportId: 'seed-report-auth-api',
  },
  {
    id: 'seed-cart-module',
    title: 'cart-module-final.rar',
    owner: 'M. Santos',
    createdAt: daysAgo(1, 9, 15),
    files: 18,
    highestSimilarity: 23.7,
    status: 'Moderate',
    language: 'Java',
    reportId: 'seed-report-cart-module',
  },
  {
    id: 'seed-student-portal',
    title: 'student-records-v2.zip',
    owner: 'M. Aquino',
    createdAt: daysAgo(2, 23, 20),
    files: 31,
    highestSimilarity: 84.3,
    status: 'Very High',
    language: 'PHP, CSS, SQL',
    reportId: 'seed-report-student-records',
  },
  {
    id: 'seed-library',
    title: 'library-catalogue.zip',
    owner: 'C. Reyes',
    createdAt: daysAgo(2, 16, 45),
    files: 16,
    highestSimilarity: 15.2,
    status: 'Low',
    language: 'Python',
    reportId: 'seed-report-library',
  },
  {
    id: 'seed-voting',
    title: 'voting-audit-build.rar',
    owner: 'A. Lopez',
    createdAt: daysAgo(2, 14, 10),
    files: 27,
    highestSimilarity: 71.8,
    status: 'High',
    language: 'C#, HTML',
    reportId: 'seed-report-voting',
  },
];

const localProjects = [...seedProjects];
const localCorpusDocuments = [];
const localReports = new Map(
  seedProjects.map((project) => [
    project.reportId,
    makeSeedReport(project),
  ]),
);
const localComparisons = [];

const localUsers = [
  { id: 'local-admin', name: 'J. Dela Torre', email: 'instructor@scsd.local', role: 'Admin', uploads: 17 },
  { id: 'local-user-1', name: 'R. Mendoza', email: 'rmendoza@scsd.local', role: 'User', uploads: 4 },
  { id: 'local-user-2', name: 'M. Santos', email: 'msantos@scsd.local', role: 'User', uploads: 3 },
  { id: 'local-user-3', name: 'A. Lopez', email: 'alopez@scsd.local', role: 'User', uploads: 5 },
];
const localAccessRequests = [];

export async function identifyRequestUser(authorizationHeader) {
  if (!supabase || !authorizationHeader?.startsWith('Bearer ')) return null;

  const token = authorizationHeader.slice('Bearer '.length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('email, full_name, role')
    .eq('id', data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: profile?.email || data.user.email,
    fullName: profile?.full_name,
    role: profile?.role || 'user',
    user_metadata: data.user.user_metadata || {},
  };
}

export async function updateCurrentUserProfile(
  { fullName, email, currentPassword, newPassword, confirmPassword } = {},
  { user } = {},
) {
  if (supabase) requireAuthenticatedUser(user);

  const cleanFullName = normalizeProfileName(fullName || user?.fullName || user?.user_metadata?.full_name);
  const normalizedEmail = normalizeEmail(email || user?.email);
  const cleanCurrentPassword = String(currentPassword || '');
  const cleanNewPassword = String(newPassword || '');
  const cleanConfirmPassword = String(confirmPassword || '');

  if (!cleanFullName) throw new ApiError(400, 'Full name is required.');
  if (cleanFullName.length > 120) throw new ApiError(400, 'Full name must be 120 characters or fewer.');
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) throw new ApiError(400, 'A valid email address is required.');
  if (cleanNewPassword && cleanNewPassword.length < 8) {
    throw new ApiError(400, 'New password must be at least 8 characters.');
  }
  if (cleanNewPassword && cleanConfirmPassword && cleanNewPassword !== cleanConfirmPassword) {
    throw new ApiError(400, 'New password and confirmation do not match.');
  }

  const emailChanged = Boolean(user?.email) && normalizedEmail !== String(user.email).trim().toLowerCase();
  const passwordChanged = Boolean(cleanNewPassword);
  const requiresCurrentPassword = emailChanged || passwordChanged;

  if (requiresCurrentPassword && !cleanCurrentPassword) {
    throw new ApiError(400, 'Current password is required to change email or password.');
  }

  if (!supabase) {
    requireLocalDemoMode();
    return {
      id: user?.id || 'local-user',
      email: normalizedEmail,
      fullName: cleanFullName,
      role: user?.role || 'user',
    };
  }

  if (requiresCurrentPassword) {
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: cleanCurrentPassword,
    });

    if (verifyError) throw new ApiError(401, 'Current password is incorrect.');
  }

  const authUpdates = {
    user_metadata: {
      ...(user.user_metadata || {}),
      full_name: cleanFullName,
    },
  };

  if (emailChanged) authUpdates.email = normalizedEmail;
  if (passwordChanged) authUpdates.password = cleanNewPassword;

  const { data: authData, error: authError } = await supabase.auth.admin.updateUserById(user.id, authUpdates);
  if (authError) {
    throw new ApiError(authError.status || 400, normalizeAuthMessage(authError.message));
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .update({
      email: normalizedEmail,
      full_name: cleanFullName,
    })
    .eq('id', user.id)
    .select('id, email, full_name, role')
    .single();

  if (profileError?.code === '23505') throw new ApiError(409, 'A user with this email already exists.');
  if (profileError) throw profileError;

  await supabase.from('activity_logs').insert({
    actor_id: user.id,
    action: 'user.profile_updated',
    entity_type: 'user',
    entity_id: user.id,
    metadata: {
      emailChanged,
      passwordChanged,
    },
  });

  return toCurrentUserProfile(profile, authData.user);
}

export async function fetchComparisonCorpus({ user } = {}) {
  if (!supabase) {
    requireLocalDemoMode();
    return [...localCorpusDocuments];
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  let query = supabase
    .from('extracted_code_files')
    .select(
      'id, project_id, file_path, language, size_bytes, content_sha256, normalized_sha256, normalized_code, fingerprint_hashes, metrics, projects(title, description, created_at)',
    )
    .limit(1000);

  if (!isAdmin) query = query.eq('owner_id', user.id);

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return [];

  return data
    .filter((row) => row.normalized_code)
    .map((row) => hydrateStoredDocument(row));
}

export async function persistAnalysis({ user, uploadedFile, sourceDocuments, sourceSubmission, analysis, reports = [] }) {
  if (!supabase) {
    requireLocalDemoMode();
    rememberLocalAnalysis({ user, uploadedFile, sourceDocuments, sourceSubmission, analysis, reports });
    return { projectId: sourceSubmission.id, reportIds: reports.map((report) => report.id) };
  }

  requireAuthenticatedUser(user);

  const projectId = sourceSubmission.id;
  const originalBuffer = await fs.readFile(uploadedFile.path);
  const storagePath = `${user.id}/${projectId}/${sanitizeStorageName(uploadedFile.originalname)}`;
  const archiveType = archiveTypeFromName(uploadedFile.originalname);

  await supabase.storage.from(config.storageBucket).upload(storagePath, originalBuffer, {
    contentType: safeContentType(uploadedFile.mimetype),
    upsert: false,
  });

  await supabase.from('projects').insert({
    id: projectId,
    owner_id: user.id,
    title: sourceSubmission.title || uploadedFile.originalname,
    description: encodeSubmissionMetadata(sourceSubmission),
    status: 'completed',
    language_summary: summarizeLanguageJson(sourceDocuments),
    highest_similarity: analysis.projectScore || 0,
    flagged: Number(analysis.projectScore || 0) >= 70,
  });

  const uploadedFileId = crypto.randomUUID();
  await supabase.from('uploaded_files').insert({
    id: uploadedFileId,
    project_id: projectId,
    owner_id: user.id,
    original_name: uploadedFile.originalname,
    storage_path: storagePath,
    mime_type: uploadedFile.mimetype,
    size_bytes: uploadedFile.size,
    sha256: sha256(originalBuffer),
    archive_type: archiveType,
  });

  const extractedRows = sourceDocuments.map((document) => ({
    id: document.id,
    project_id: projectId,
    owner_id: user.id,
    uploaded_file_id: uploadedFileId,
    file_path: document.filePath,
    language: document.language,
    size_bytes: document.sizeBytes,
    content_sha256: document.contentSha256,
    normalized_sha256: document.normalizedSha256,
    normalized_code: document.normalizedText.slice(0, 150000),
    fingerprint_hashes: Array.from(document.fingerprints).slice(0, 2000),
    metrics: {
      tokenCount: document.normalizedTokens.length,
      identifierCount: document.identifiers.length,
      rawCode: document.rawText.slice(0, 150000),
      structure: document.structure,
      styleFingerprint: document.styleFingerprint,
    },
  }));

  await supabase.from('extracted_code_files').insert(extractedRows);

  if (reports.length) {
    const similarityRows = reports.map((report) => ({
      id: report.id,
      source_project_id: report.sourceSubmissionId,
      compared_project_id: report.comparedSubmissionId,
      owner_id: user.id,
      similarity_score: report.similarityScore,
      exact_match_score: report.exactMatchScore || 0,
      token_score: report.tokenSimilarityScore || 0,
      structure_score: report.structuralSimilarityScore || 0,
      fingerprint_score: report.fingerprintSimilarityScore || 0,
      semantic_score: report.semanticSimilarityScore || null,
      explanation: report.summary,
      status: 'completed',
    }));

    const { error: resultError } = await supabase.from('similarity_results').insert(similarityRows);
    if (resultError) throw resultError;

    const matchedSectionRows = reports.flatMap((report) =>
      (report.matchedSections || []).map((section) => ({
        similarity_result_id: report.id,
        source_file_id: section.sourceFileId,
        compared_file_id: section.comparedFileId,
        source_file_path: section.sourceFile,
        compared_file_path: section.comparedFile,
        source_start_line: firstLineNumber(section.sourceLines),
        source_end_line: lastLineNumber(section.sourceLines),
        compared_start_line: firstLineNumber(section.comparedLines),
        compared_end_line: lastLineNumber(section.comparedLines),
        source_snippet: section.sourceSnippet,
        compared_snippet: section.comparedSnippet,
        match_type: section.matchType,
        confidence: section.confidence,
      })),
    );

    if (matchedSectionRows.length) {
      const { error: sectionError } = await supabase.from('matched_code_sections').insert(matchedSectionRows);
      if (sectionError) throw sectionError;
    }

    const reportRows = reports.map((report) => ({
      id: report.id,
      project_id: projectId,
      owner_id: user.id,
      title: `${report.submissionCompared.source.title} vs ${report.submissionCompared.compared.title}`,
      summary: report.summary,
      report_json: report,
    }));

    const { error: reportError } = await supabase.from('reports').insert(reportRows);
    if (reportError) throw reportError;
  }

  await supabase.from('activity_logs').insert({
    actor_id: user.id,
    action: reports.length ? 'submission.compared' : 'submission.indexed',
    entity_type: 'project',
    entity_id: projectId,
    metadata: {
      fileCount: sourceDocuments.length,
      comparisonCount: reports.length,
      similarityScore: analysis.projectScore || 0,
    },
  });

  return { projectId, reportIds: reports.map((report) => report.id) };
}

export async function fetchDashboardData({ user } = {}) {
  if (!supabase) {
    requireLocalDemoMode();
    return buildDashboardPayload({
      projects: localProjects,
      users: localUsers,
      displayName: displayNameFromUser(user),
    });
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  let query = supabase
    .from('projects')
    .select('id, title, description, highest_similarity, flagged, status, created_at, language_summary, extracted_code_files(id), reports(id, report_json, created_at), users(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (!isAdmin) query = query.eq('owner_id', user.id);

  const { data: projects, error } = await query;
  if (error) throw error;

  return buildDashboardPayload({
    projects: (projects || []).map((project) => ({
      id: project.id,
      title: project.title,
      owner: submissionStudentName(project, project.users),
      uploadedBy: uploaderAccountName(project, project.users),
      uploadedByEmail: uploaderAccountEmail(project, project.users),
      createdAt: project.created_at,
      files: project.extracted_code_files?.length || 0,
      highestSimilarity: Number(project.highest_similarity || 0),
      status: reportDecisionStatusLabel(latestReportDecision(project.reports)) || statusFromScore(Number(project.highest_similarity || 0)),
      language: Object.keys(project.language_summary || {}).join(', ') || 'Mixed',
      reportId: latestReportId(project.reports) || project.id,
      reviewDecision: latestReportDecision(project.reports),
    })),
    users: [],
    displayName: displayNameFromUser(user),
  });
}

export async function fetchProjectList({ user } = {}) {
  if (!supabase) {
    requireLocalDemoMode();
    return localProjects;
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  let query = supabase
    .from('projects')
    .select('id, owner_id, title, description, language_summary, status, highest_similarity, flagged, created_at, extracted_code_files(id), reports(id, report_json, created_at), users(full_name, email)')
    .order('created_at', { ascending: false });

  if (!isAdmin) query = query.eq('owner_id', user.id);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((project) => ({
    id: project.id,
    title: project.title,
    owner: submissionStudentName(project, project.users),
    uploadedBy: uploaderAccountName(project, project.users),
    uploadedByEmail: uploaderAccountEmail(project, project.users),
    uploadedById: project.owner_id,
    createdAt: project.created_at,
    files: project.extracted_code_files?.length || 0,
    highestSimilarity: Number(project.highest_similarity || 0),
    status:
      reportDecisionStatusLabel(latestReportDecision(project.reports)) ||
      (Number(project.highest_similarity || 0) === 0 ? 'Indexed' : project.flagged ? 'Flagged' : 'Cleared'),
    language: Object.keys(project.language_summary || {}).join(', ') || 'Mixed',
    reportId: latestReportId(project.reports) || project.id,
    reviewDecision: latestReportDecision(project.reports),
  }));
}

export async function fetchSubmissionRepository({ user } = {}) {
  if (!supabase) {
    requireLocalDemoMode();
    return localProjects.map((project) => toSubmissionRepositoryRow(project));
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  let query = supabase
    .from('projects')
    .select('id, title, description, language_summary, status, created_at, extracted_code_files(id), users(full_name, email)')
    .order('created_at', { ascending: false });

  if (!isAdmin) query = query.eq('owner_id', user.id);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((project) => toSubmissionRepositoryRow(project, project.users));
}

export async function fetchComparisonHistory({ user } = {}) {
  if (!supabase) {
    requireLocalDemoMode();
    return localComparisons;
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  let query = supabase
    .from('similarity_results')
    .select(
      'id, source_project_id, compared_project_id, similarity_score, exact_match_score, structure_score, semantic_score, created_at',
    )
    .order('created_at', { ascending: false });

  if (!isAdmin) query = query.eq('owner_id', user.id);

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return [];

  const projectIds = Array.from(
    new Set(data.flatMap((row) => [row.source_project_id, row.compared_project_id]).filter(Boolean)),
  );

  const { data: projectRows, error: projectError } = await supabase
    .from('projects')
    .select('id, title, description')
    .in('id', projectIds);

  if (projectError) throw projectError;

  const projectsById = new Map((projectRows || []).map((project) => [project.id, project]));
  const reportIds = data.map((row) => row.id).filter(Boolean);
  const { data: reportRows, error: reportError } = reportIds.length
    ? await supabase.from('reports').select('id, report_json').in('id', reportIds)
    : { data: [], error: null };

  if (reportError) throw reportError;

  const reportsById = new Map((reportRows || []).map((report) => [report.id, report]));

  return data.map((row) => ({
    id: row.id,
    reportId: row.id,
    sourceSubmissionId: row.source_project_id,
    comparedSubmissionId: row.compared_project_id,
    submissionA: submissionDisplayName(projectsById.get(row.compared_project_id)),
    submissionB: submissionDisplayName(projectsById.get(row.source_project_id)),
    similarityScore: Number(row.similarity_score || 0),
    exactMatchScore: Number(row.exact_match_score || 0),
    structuralSimilarityScore: Number(row.structure_score || 0),
    semanticSimilarityScore: Number(row.semantic_score || 0),
    scanDate: row.created_at,
    reviewDecision: reportsById.get(row.id)?.report_json?.reviewDecision || null,
    reviewStatus: reportDecisionStatusLabel(reportsById.get(row.id)?.report_json?.reviewDecision) || 'Pending Review',
  }));
}

export async function fetchReportById(reportId, { user } = {}) {
  const safeReportId = validateLookupId(reportId, 'report id');

  if (!supabase) {
    requireLocalDemoMode();
    return localReports.get(safeReportId) || localReports.get(localProjects.find((project) => project.id === safeReportId)?.reportId);
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  const reportRow =
    (await fetchReportRowByColumn('id', safeReportId, { user, isAdmin })) ||
    (await fetchReportRowByColumn('project_id', safeReportId, { user, isAdmin }));

  return enrichReportEvidence(reportRow?.report_json || null);
}

export async function updateReportDecision(reportId, { decision, note } = {}, { user } = {}) {
  const safeReportId = validateLookupId(reportId, 'report id');
  const normalizedDecision = normalizeReportDecisionStatus(decision);

  if (!normalizedDecision) {
    throw new ApiError(400, 'Decision must be approved or resubmit.');
  }

  const reviewDecision = {
    status: normalizedDecision,
    label: reportDecisionStatusLabel({ status: normalizedDecision }),
    note: String(note || '').trim().slice(0, 500),
    decidedAt: new Date().toISOString(),
    decidedBy: user?.email || user?.fullName || 'Instructor',
  };

  if (!supabase) {
    requireLocalDemoMode();
    const existingReport = localReports.get(safeReportId);
    if (!existingReport) throw new ApiError(404, 'Report not found.');

    const updatedReport = { ...existingReport, reviewDecision };
    localReports.set(safeReportId, updatedReport);

    const comparison = localComparisons.find((item) => item.reportId === safeReportId || item.id === safeReportId);
    if (comparison) {
      comparison.reviewDecision = reviewDecision;
      comparison.reviewStatus = reviewDecision.label;
    }

    const project = localProjects.find((item) => item.reportId === safeReportId || item.id === updatedReport.projectId);
    if (project) {
      project.reviewDecision = reviewDecision;
      project.status = reviewDecision.label;
    }

    return updatedReport;
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  const reportRow = await fetchReportRowByColumn('id', safeReportId, { user, isAdmin });
  if (!reportRow) throw new ApiError(404, 'Report not found.');

  const reportJson = {
    ...(reportRow.report_json || {}),
    reviewDecision,
  };

  const { data, error } = await supabase
    .from('reports')
    .update({ report_json: reportJson })
    .eq('id', safeReportId)
    .select('report_json')
    .single();

  if (error) throw error;

  await supabase.from('activity_logs').insert({
    actor_id: user.id,
    action: 'report.review_decision',
    entity_type: 'report',
    entity_id: safeReportId,
    metadata: {
      decision: normalizedDecision,
      label: reviewDecision.label,
    },
  });

  return enrichReportEvidence(data?.report_json || reportJson);
}

export async function deleteProjectById(projectId, { user } = {}) {
  const safeProjectId = validateLookupId(projectId, 'project id');

  if (!supabase) {
    requireLocalDemoMode();
    const index = localProjects.findIndex((project) => project.id === safeProjectId);
    if (index === -1) return false;
    const [removed] = localProjects.splice(index, 1);
    if (removed?.reportId) localReports.delete(removed.reportId);
    return true;
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  let query = supabase.from('projects').delete().eq('id', safeProjectId);
  if (!isAdmin) query = query.eq('owner_id', user.id);

  const { error } = await query;
  if (error) throw error;
  return true;
}

export async function deleteComparisonById(comparisonId, { user } = {}) {
  const safeComparisonId = validateLookupId(comparisonId, 'comparison id');

  if (!supabase) {
    requireLocalDemoMode();
    const index = localComparisons.findIndex(
      (comparison) => comparison.id === safeComparisonId || comparison.reportId === safeComparisonId,
    );
    const hadReport = localReports.delete(safeComparisonId);
    if (index === -1 && !hadReport) return false;
    if (index !== -1) localComparisons.splice(index, 1);
    localProjects.forEach((project) => {
      if (project.reportId === safeComparisonId) project.reportId = null;
    });
    return true;
  }

  requireAuthenticatedUser(user);
  const isAdmin = await userIsAdmin(user.id);
  let lookupQuery = supabase.from('similarity_results').select('id, owner_id').eq('id', safeComparisonId).maybeSingle();
  if (!isAdmin) lookupQuery = lookupQuery.eq('owner_id', user.id);

  const { data: comparison, error: lookupError } = await lookupQuery;
  if (lookupError) throw lookupError;
  if (!comparison) return false;

  let reportDelete = supabase.from('reports').delete().eq('id', safeComparisonId);
  let comparisonDelete = supabase.from('similarity_results').delete().eq('id', safeComparisonId);

  if (!isAdmin) {
    reportDelete = reportDelete.eq('owner_id', user.id);
    comparisonDelete = comparisonDelete.eq('owner_id', user.id);
  }

  const [{ error: reportError }, { error: comparisonError }] = await Promise.all([reportDelete, comparisonDelete]);
  if (reportError) throw reportError;
  if (comparisonError) throw comparisonError;

  await supabase.from('activity_logs').insert({
    actor_id: user.id,
    action: 'comparison.deleted',
    entity_type: 'similarity_result',
    entity_id: safeComparisonId,
    metadata: {},
  });

  return true;
}

async function fetchReportRowByColumn(column, value, { user, isAdmin }) {
  let query = supabase
    .from('reports')
    .select('id, owner_id, report_json, created_at')
    .eq(column, value)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!isAdmin) query = query.eq('owner_id', user.id);

  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] || null;
}

async function enrichReportEvidence(report) {
  if (!report || report.waiting) return report;
  if (Array.isArray(report.matchedSections) && report.matchedSections.length > 0) {
    const repaired = await repairNormalizedMatchedSections(report);
    const filtered = filterBoilerplateOnlyMatchedSections(repaired);
    if (filtered.matchedSections?.length) {
      const rebuiltExactSections = await rebuildExactFullFileSectionsIfNeeded(filtered);
      if (rebuiltExactSections?.length) {
        return recalibrateReportFromMatchedSections({
          ...filtered,
          matchedSections: rebuiltExactSections,
        });
      }

      return recalibrateReportFromMatchedSections(filtered);
    }

    const rebuiltSections = await buildEvidenceSectionsFromPairs(report);
    if (rebuiltSections.length) {
      return recalibrateReportFromMatchedSections({
        ...filtered,
        matchedSections: rebuiltSections,
      });
    }

    return markBoilerplateOnlyReport(filtered);
  }
  if (!Array.isArray(report.filePairs) || report.filePairs.length === 0) return report;

  const sections = await buildEvidenceSectionsFromPairs(report);
  if (!sections.length) return report;

  const filtered = filterBoilerplateOnlyMatchedSections({
    ...report,
    matchedSections: sections,
  });

  if (!filtered.matchedSections?.length) return markBoilerplateOnlyReport(filtered);
  return recalibrateReportFromMatchedSections(filtered);
}

async function buildEvidenceSectionsFromPairs(report) {
  const sections = [];
  const pairs = Array.isArray(report.filePairs) ? report.filePairs : [];

  for (const pair of pairs.slice(0, 6)) {
    const evidence = await loadEvidenceDocumentsForPair(report, pair);
    if (!evidence?.source || !evidence?.compared) continue;

    const fullFile = isExactFullFileEvidence(report, pair);
    const sourceBlock = await storedSnippetBlock(evidence.source, { fullFile });
    const comparedBlock = await storedSnippetBlock(evidence.compared, { fullFile });
    if (!sourceBlock || !comparedBlock) continue;

    sections.push({
      sourceFileId: evidence.source.id,
      comparedFileId: evidence.compared.id,
      sourceFile: evidence.source.file_path || pair.source,
      comparedFile: evidence.compared.file_path || pair.compared,
      sourceLines: sourceBlock.lines,
      comparedLines: comparedBlock.lines,
      sourceSnippet: sourceBlock.snippet,
      comparedSnippet: comparedBlock.snippet,
      confidence: Math.round(Number(pair.score || report.similarityScore || 0)),
      matchType: fullFile ? 'copied_full_file' : String(pair.matchType || '').toLowerCase().includes('exact') ? 'copied_code' : 'similar_logic',
    });
  }

  return sections;
}

async function rebuildExactFullFileSectionsIfNeeded(report) {
  if (!shouldRebuildExactFullFileSections(report)) return [];
  return buildEvidenceSectionsFromPairs(report);
}

function shouldRebuildExactFullFileSections(report) {
  if (!Array.isArray(report.filePairs) || report.filePairs.length === 0) return false;
  return report.filePairs.some((pair) => isExactFullFileEvidence(report, pair)) && hasShortLineOnlyEvidence(report);
}

function hasShortLineOnlyEvidence(report) {
  return (report.matchedSections || []).every((section) => {
    const sourceLines = parseLineRange(section.sourceLines);
    const comparedLines = parseLineRange(section.comparedLines);
    return sourceLines <= 1 && comparedLines <= 1;
  });
}

function parseLineRange(value) {
  const [start, end] = String(value || '')
    .split('-')
    .map((part) => Number.parseInt(part, 10));

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, end - start + 1);
}

function isExactFullFileEvidence(report, pair = {}) {
  const matchType = String(pair.matchType || '').toLowerCase();
  const explanation = String(pair.explanation || '').toLowerCase();
  const pairScore = Number(pair.score || 0);
  const reportScore = Number(report.similarityScore || 0);
  const exactScore = Number(report.exactMatchScore || pair.metrics?.exact || 0);

  return (
    (pairScore >= 99 || reportScore >= 99) &&
    (exactScore >= 99 ||
      matchType.includes('exact full-file') ||
      matchType.includes('exact full file') ||
      explanation.includes('exact full-file') ||
      explanation.includes('exact full file'))
  );
}

async function loadEvidenceDocumentsForPair(report, pair) {
  if (pair.sourceId && pair.comparedId) {
    const { data, error } = await supabase
      .from('extracted_code_files')
      .select('id, project_id, file_path, language, normalized_code, metrics, uploaded_files(storage_path, archive_type, original_name)')
      .in('id', [pair.sourceId, pair.comparedId]);

    if (error) throw error;
    const byId = new Map((data || []).map((row) => [row.id, row]));
    if (byId.has(pair.sourceId) && byId.has(pair.comparedId)) {
      return {
        source: byId.get(pair.sourceId),
        compared: byId.get(pair.comparedId),
      };
    }
  }

  const sourceProjectId =
    pair.sourceSubmissionId || report.sourceSubmissionId || report.submissionCompared?.source?.id || report.projectId;
  const comparedProjectId =
    pair.comparedSubmissionId || report.comparedSubmissionId || report.submissionCompared?.compared?.id;

  if (!sourceProjectId || !comparedProjectId || !pair.source || !pair.compared) return null;

  const [source, compared] = await Promise.all([
    loadEvidenceDocumentByPath(sourceProjectId, pair.source),
    loadEvidenceDocumentByPath(comparedProjectId, pair.compared),
  ]);

  return source && compared ? { source, compared } : null;
}

async function loadEvidenceDocumentByPath(projectId, filePath) {
  const { data, error } = await supabase
    .from('extracted_code_files')
    .select('id, project_id, file_path, language, normalized_code, metrics, uploaded_files(storage_path, archive_type, original_name)')
    .eq('project_id', projectId)
    .eq('file_path', filePath)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function repairNormalizedMatchedSections(report) {
  if (!hasNormalizedSnippetText(report.matchedSections)) return report;
  if (!Array.isArray(report.filePairs) || report.filePairs.length === 0) return report;

  const repairedSections = [];

  for (const section of report.matchedSections) {
    const pair = findPairForMatchedSection(report.filePairs, section);
    if (!pair) {
      repairedSections.push(section);
      continue;
    }

    const evidence = await loadEvidenceDocumentsForPair(report, pair);
    if (!evidence?.source || !evidence?.compared) {
      repairedSections.push(section);
      continue;
    }

    const sourceBlock = await storedSnippetBlock(evidence.source);
    const comparedBlock = await storedSnippetBlock(evidence.compared);
    if (!sourceBlock || !comparedBlock) {
      repairedSections.push(section);
      continue;
    }

    repairedSections.push({
      ...section,
      sourceSnippet: looksLikeNormalizedTokens(section.sourceSnippet) ? sourceBlock.snippet : section.sourceSnippet,
      comparedSnippet: looksLikeNormalizedTokens(section.comparedSnippet) ? comparedBlock.snippet : section.comparedSnippet,
      sourceLines: section.sourceLines || sourceBlock.lines,
      comparedLines: section.comparedLines || comparedBlock.lines,
    });
  }

  return {
    ...report,
    matchedSections: repairedSections,
  };
}

function filterBoilerplateOnlyMatchedSections(report) {
  const sections = Array.isArray(report.matchedSections) ? report.matchedSections : [];
  if (!sections.length) return report;

  const filteredSections = sections.filter((section) => !isBoilerplateOnlyMatchedSection(section));
  if (filteredSections.length === sections.length) return report;

  return {
    ...report,
    boilerplateOnlyMatch: filteredSections.length === 0 || Boolean(report.boilerplateOnlyMatch),
    matchedSections: filteredSections,
  };
}

function isBoilerplateOnlyMatchedSection(section = {}) {
  return (
    isCommonHtmlBoilerplateSnippet(section.sourceSnippet, {
      filePath: section.sourceFile,
      language: 'HTML',
    }) &&
    isCommonHtmlBoilerplateSnippet(section.comparedSnippet, {
      filePath: section.comparedFile,
      language: 'HTML',
    })
  );
}

function markBoilerplateOnlyReport(report) {
  return {
    ...report,
    similarityScore: 0,
    exactMatchScore: 0,
    tokenSimilarityScore: 0,
    structuralSimilarityScore: 0,
    semanticSimilarityScore: 0,
    fingerprintSimilarityScore: 0,
    variableRenameScore: 0,
    variableRenameDetection: {
      detected: false,
      score: 0,
    },
    boilerplateOnlyMatch: true,
    summary: htmlBoilerplateOnlySummary,
    chartData: zeroReportChartData(report.chartData),
    filePairs: [],
    matchedSections: [],
    renamedVariables: [],
  };
}

function zeroReportChartData(chartData = []) {
  const defaultChartData = [
    { name: 'Exact', value: 0 },
    { name: 'Structure', value: 0 },
    { name: 'Semantic', value: 0 },
    { name: 'Renamed', value: 0 },
  ];

  if (!Array.isArray(chartData) || chartData.length === 0) return defaultChartData;
  return chartData.map((item) => ({
    ...item,
    value: 0,
  }));
}

function recalibrateReportFromMatchedSections(report) {
  const section = (report.matchedSections || []).find((item) => item.sourceSnippet && item.comparedSnippet);
  if (!section) return report;

  const sourceDocument = snippetToSourceDocument({
    projectId: report.sourceSubmissionId || report.projectId || 'source',
    filePath: section.sourceFile || 'source.txt',
    rawText: section.sourceSnippet,
  });
  const comparedDocument = snippetToSourceDocument({
    projectId: report.comparedSubmissionId || 'compared',
    filePath: section.comparedFile || 'compared.txt',
    rawText: section.comparedSnippet,
  });
  const metrics = compareDocuments(sourceDocument, comparedDocument);
  const recalibratedScore = Math.round(metrics.combinedScore * 100);
  const currentScore = Number(report.similarityScore || 0);

  if (!Number.isFinite(recalibratedScore) || recalibratedScore <= currentScore) return report;

  const metricPercentages = reportPercentMetrics(metrics, report);
  const updatedFilePairs = Array.isArray(report.filePairs)
    ? report.filePairs.map((pair, index) =>
        index === 0 || (pair.source === section.sourceFile && pair.compared === section.comparedFile)
          ? {
              ...pair,
              score: Math.max(Number(pair.score || 0), recalibratedScore),
              metrics: {
                ...(pair.metrics || {}),
                ...metricPercentages,
              },
              matchType: reportMatchTypeFromMetrics(metrics, pair.matchType),
              explanation:
                metrics.exactFullContentScore >= 0.98 || metrics.exactLineScore >= 0.98
                  ? 'The recovered source snippets are an exact full-file match after normalizing line endings and trailing spaces.'
                  : pair.explanation,
            }
          : pair,
      )
    : report.filePairs;

  return {
    ...report,
    similarityScore: recalibratedScore,
    exactMatchScore: Math.max(Number(report.exactMatchScore || 0), metricPercentages.exact),
    tokenSimilarityScore: Math.max(Number(report.tokenSimilarityScore || 0), metricPercentages.tokens),
    structuralSimilarityScore: Math.max(Number(report.structuralSimilarityScore || 0), metricPercentages.structure),
    fingerprintSimilarityScore: Math.max(Number(report.fingerprintSimilarityScore || 0), metricPercentages.fingerprint),
    variableRenameScore: Math.max(Number(report.variableRenameScore || 0), metricPercentages.renamedVariables),
    summary: buildRecalibratedSummary(report, recalibratedScore),
    chartData: updateReportChartData(report.chartData, metricPercentages),
    filePairs: updatedFilePairs,
    matchedSections: report.matchedSections.map((item) =>
      item === section ? { ...item, confidence: Math.max(Number(item.confidence || 0), recalibratedScore) } : item,
    ),
  };
}

function snippetToSourceDocument({ projectId, filePath, rawText }) {
  return toSourceDocument({
    projectId,
    ownerId: 'report-evidence',
    filePath,
    language: path.extname(filePath).slice(1).toUpperCase() || 'Text',
    sizeBytes: Buffer.byteLength(String(rawText || ''), 'utf8'),
    sha256: sha256(rawText || ''),
    rawText,
  });
}

function reportPercentMetrics(metrics, report) {
  return {
    exact: Math.round(metrics.exactScore * 100),
    tokens: Math.round(metrics.tokenScore * 100),
    structure: Math.round(metrics.structureScore * 100),
    fingerprint: Math.round(metrics.fingerprintScore * 100),
    renamedVariables: Math.round(metrics.renamedVariableScore * 100),
    semantic: Number(report.semanticSimilarityScore || chartValue(report.chartData, 'Semantic') || 0),
  };
}

function reportMatchTypeFromMetrics(metrics, fallback = 'Similarity evidence') {
  if (metrics.exactFullContentScore >= 0.98 || metrics.exactLineScore >= 0.98) return 'Exact full-file match';
  if (metrics.exactScore >= 0.98) return 'Exact copied code';
  if (metrics.nearDuplicateScore >= 0.92) return 'Near-identical copied code';
  if (metrics.shortFileBoostScore >= 0.9) return 'Short-file high token match';
  return fallback;
}

function updateReportChartData(chartData = [], metrics) {
  const values = {
    Exact: metrics.exact,
    Structure: metrics.structure,
    Semantic: metrics.semantic,
    Renamed: metrics.renamedVariables,
  };
  const existing = Array.isArray(chartData) && chartData.length ? chartData : Object.keys(values).map((name) => ({ name, value: 0 }));
  return existing.map((item) => ({
    ...item,
    value: Math.max(Number(item.value || 0), Number(values[item.name] || 0)),
  }));
}

function buildRecalibratedSummary(report, score) {
  if (score >= 100) {
    return `${report.projectTitle || 'This comparison'} is an exact full-file match after normalizing line endings and trailing spaces.`;
  }
  if (score >= 90) {
    return `${report.projectTitle || 'This comparison'} has very high short-file token overlap. Review the recovered code snippets manually before making a decision.`;
  }
  return report.summary;
}

function chartValue(chartData = [], name) {
  return chartData.find((item) => item.name === name)?.value;
}

function findPairForMatchedSection(filePairs = [], section = {}) {
  return filePairs.find(
    (pair) =>
      (pair.sourceId && pair.sourceId === section.sourceFileId && pair.comparedId === section.comparedFileId) ||
      (pair.source === section.sourceFile && pair.compared === section.comparedFile),
  );
}

function hasNormalizedSnippetText(sections = []) {
  return sections.some(
    (section) =>
      looksLikeNormalizedTokens(section.sourceSnippet) ||
      looksLikeNormalizedTokens(section.comparedSnippet),
  );
}

function looksLikeNormalizedTokens(value) {
  const text = String(value || '');
  if (!text) return false;
  const identifierTokens = text.match(/\bID\d+\b/g) || [];
  const numberTokens = text.match(/\bNUM\b/g) || [];
  return identifierTokens.length >= 3 || (identifierTokens.length >= 1 && numberTokens.length >= 1);
}

async function storedSnippetBlock(row, { fullFile = false } = {}) {
  const text = String(row?.metrics?.rawCode || (await loadOriginalCodeFromStorage(row)) || row?.normalized_code || '').trim();
  if (!text) return null;

  const sourceLines = text.includes('\n') ? text.split(/\r?\n/) : wrapText(text, 74);
  const entries = sourceLines
    .map((line, index) => ({
      lineNumber: index + 1,
      text: line.replace(/[ \t]+$/g, ''),
    }))
    .filter((line) => line.text.trim())
    .filter(
      (line) =>
        !isCommonHtmlBoilerplateSnippet(line.text, {
          filePath: row?.file_path,
          language: row?.language,
        }),
    );

  const visibleEntries = fullFile ? entries : entries.slice(0, 12);

  if (!visibleEntries.length) return null;

  const firstLine = visibleEntries[0].lineNumber;
  const lastLine = visibleEntries[visibleEntries.length - 1].lineNumber;

  return {
    lines: `${firstLine}-${lastLine}`,
    snippet: visibleEntries.map((line) => line.text).join('\n'),
  };
}

async function loadOriginalCodeFromStorage(row) {
  const uploadedFile = firstProfile(row?.uploaded_files);
  if (!uploadedFile?.storage_path || uploadedFile.archive_type !== 'single') return '';

  try {
    const { data, error } = await supabase.storage.from(config.storageBucket).download(uploadedFile.storage_path);
    if (error || !data) return '';

    const buffer = Buffer.from(await data.arrayBuffer());
    return sourceTextDecoder.decode(buffer);
  } catch {
    return '';
  }
}

function wrapText(text, maxLength) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (nextLine.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }

  if (line) lines.push(line);
  return lines;
}

export async function fetchAdminUsers({ user } = {}) {
  if (!supabase) {
    requireLocalDemoMode();
    return localUsers;
  }
  requireAuthenticatedUser(user);
  if (!(await userIsAdmin(user.id))) throw new ApiError(403, 'Admin access is required.');

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, projects(id)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row) => toAdminUser(row));
}

export async function requestProfessorAccess({ email, fullName } = {}) {
  const { normalizedEmail, displayName } = validateAccessRequestInput({ email, fullName });
  const now = new Date().toISOString();

  if (!supabase) {
    requireLocalDemoMode();
    const existingRequest = localAccessRequests.find(
      (request) => request.email.toLowerCase() === normalizedEmail && request.status === 'Pending',
    );
    if (existingRequest) return existingRequest;

    const accessRequest = {
      id: crypto.randomUUID(),
      name: displayName,
      email: normalizedEmail,
      status: 'Pending',
      createdAt: now,
    };
    localAccessRequests.unshift(accessRequest);
    return accessRequest;
  }

  const { data, error } = await supabase
    .from('activity_logs')
    .insert({
      actor_id: null,
      action: 'access.requested',
      entity_type: 'access_request',
      metadata: {
        email: normalizedEmail,
        fullName: displayName,
        status: 'pending',
        requestedAt: now,
      },
    })
    .select('id, metadata, created_at')
    .single();

  if (error) throw error;
  return toAccessRequest(data);
}

export async function fetchAccessRequests({ user } = {}) {
  if (!supabase) {
    requireLocalDemoMode();
    return [...localAccessRequests];
  }

  requireAuthenticatedUser(user);
  if (!(await userIsAdmin(user.id))) throw new ApiError(403, 'Admin access is required.');

  const { data, error } = await supabase
    .from('activity_logs')
    .select('id, metadata, created_at')
    .eq('action', 'access.requested')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return dedupeAccessRequests(data || []);
}

export async function updateAccessRequestStatus(requestId, status, { user } = {}) {
  const safeRequestId = validateLookupId(requestId, 'access request id');
  const normalizedStatus = normalizeAccessRequestStatus(status);

  if (!['pending', 'approved', 'rejected'].includes(normalizedStatus)) {
    throw new ApiError(400, 'Status must be pending, approved, or rejected.');
  }

  if (!supabase) {
    requireLocalDemoMode();
    const target = localAccessRequests.find((request) => request.id === safeRequestId);
    if (!target) throw new ApiError(404, 'Access request not found.');
    target.status = formatAccessRequestStatus(normalizedStatus);
    target.reviewedAt = new Date().toISOString();
    return target;
  }

  requireAuthenticatedUser(user);
  if (!(await userIsAdmin(user.id))) throw new ApiError(403, 'Admin access is required.');

  const { data: existingRequest, error: readError } = await supabase
    .from('activity_logs')
    .select('id, metadata, created_at')
    .eq('id', safeRequestId)
    .eq('action', 'access.requested')
    .maybeSingle();

  if (readError) throw readError;
  if (!existingRequest) throw new ApiError(404, 'Access request not found.');

  const metadata = {
    ...(existingRequest.metadata || {}),
    status: normalizedStatus,
    reviewedAt: new Date().toISOString(),
    reviewedBy: user.id,
  };

  const { data, error } = await supabase
    .from('activity_logs')
    .update({ metadata })
    .eq('id', safeRequestId)
    .select('id, metadata, created_at')
    .single();

  if (error) throw error;
  return toAccessRequest(data);
}

export async function createAdminUser({ email, password, fullName, role }, { user } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || 'user').toLowerCase();
  const cleanName = String(fullName || '').trim();

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new ApiError(400, 'A valid email address is required.');
  }

  if (!password || String(password).length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters.');
  }

  if (!['admin', 'user'].includes(normalizedRole)) {
    throw new ApiError(400, 'Role must be admin or user.');
  }

  const displayName = cleanName || normalizedEmail.split('@')[0];

  if (!supabase) {
    requireLocalDemoMode();
    const exists = localUsers.some((localUser) => localUser.email.toLowerCase() === normalizedEmail);
    if (exists) throw new ApiError(409, 'A user with this email already exists.');

    const created = {
      id: crypto.randomUUID(),
      name: displayName,
      email: normalizedEmail,
      role: normalizedRole === 'admin' ? 'Admin' : 'User',
      uploads: 0,
    };
    localUsers.unshift(created);
    return created;
  }

  requireAuthenticatedUser(user);
  if (!(await userIsAdmin(user.id))) throw new ApiError(403, 'Admin access is required.');

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: displayName,
    },
  });

  if (authError) {
    const message = authError.message || 'Unable to create authentication user.';
    throw new ApiError(authError.status || 400, message);
  }

  const createdUserId = authData.user?.id;
  if (!createdUserId) throw new ApiError(500, 'Supabase did not return a new user id.');

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .upsert(
      {
        id: createdUserId,
        email: normalizedEmail,
        full_name: displayName,
        role: normalizedRole,
      },
      { onConflict: 'id' },
    )
    .select('id, full_name, email, role, projects(id)')
    .single();

  if (profileError) throw profileError;

  await supabase.from('activity_logs').insert({
    actor_id: user.id,
    action: 'user.created',
    entity_type: 'user',
    entity_id: createdUserId,
    metadata: {
      email: normalizedEmail,
      role: normalizedRole,
    },
  });

  return toAdminUser(profile);
}

export async function updateUserRole(userId, nextRole, { user } = {}) {
  const safeUserId = validateLookupId(userId, 'user id');
  const normalizedRole = String(nextRole || '').toLowerCase();

  if (!['admin', 'user'].includes(normalizedRole)) {
    throw new ApiError(400, 'Role must be admin or user.');
  }

  if (!supabase) {
    requireLocalDemoMode();
    const target = localUsers.find((localUser) => localUser.id === safeUserId);
    if (!target) throw new ApiError(404, 'User not found.');
    target.role = normalizedRole === 'admin' ? 'Admin' : 'User';
    return target;
  }

  requireAuthenticatedUser(user);
  if (!(await userIsAdmin(user.id))) throw new ApiError(403, 'Admin access is required.');

  if (user.id === safeUserId && normalizedRole !== 'admin') {
    throw new ApiError(400, 'You cannot remove your own admin access.');
  }

  const { data, error } = await supabase
    .from('users')
    .update({ role: normalizedRole })
    .eq('id', safeUserId)
    .select('id, full_name, email, role, projects(id)')
    .single();

  if (error) throw error;
  if (!data) throw new ApiError(404, 'User not found.');

  await supabase.from('activity_logs').insert({
    actor_id: user.id,
    action: 'user.role_updated',
    entity_type: 'user',
    entity_id: safeUserId,
    metadata: { role: normalizedRole },
  });

  return toAdminUser(data);
}

function rememberLocalAnalysis({ user, uploadedFile, sourceDocuments, sourceSubmission, analysis, reports }) {
  const project = {
    id: sourceSubmission.id,
    title: sourceSubmission.title || uploadedFile.originalname,
    studentName: sourceSubmission.studentName || displayNameFromUser(user),
    subject: sourceSubmission.subject || 'Unassigned',
    section: sourceSubmission.section || 'Unassigned',
    owner: sourceSubmission.studentName || displayNameFromUser(user),
    createdAt: new Date().toISOString(),
    files: sourceDocuments.length,
    highestSimilarity: analysis.projectScore || 0,
    status: reports.length ? statusFromScore(analysis.projectScore || 0) : 'Indexed',
    language: summarizeLanguageText(sourceDocuments),
    reportId: reports[0]?.id || sourceSubmission.id,
    uploadedBy: displayNameFromUser(user),
    uploadedByEmail: user?.email || '',
    uploadedById: user?.id || '',
  };

  localProjects.unshift(project);
  for (const report of reports) {
    localReports.set(report.id, report);
    localComparisons.unshift({
      id: report.id,
      reportId: report.id,
      sourceSubmissionId: report.sourceSubmissionId,
      comparedSubmissionId: report.comparedSubmissionId,
      submissionA: report.submissionCompared.compared.title,
      submissionB: report.submissionCompared.source.title,
      similarityScore: report.similarityScore,
      exactMatchScore: report.exactMatchScore,
      structuralSimilarityScore: report.structuralSimilarityScore,
      semanticSimilarityScore: report.semanticSimilarityScore,
      scanDate: report.generatedAt,
    });
  }
  localCorpusDocuments.push(
    ...sourceDocuments.map((document) => ({
      ...document,
      projectTitle: project.title,
      studentName: project.studentName,
      subject: project.subject,
      section: project.section,
      submittedAt: project.createdAt,
    })),
  );
}

function buildDashboardPayload({ projects, users, displayName }) {
  const totalProjects = Math.max(projects.length, 0);
  const totalChecks = projects.filter((project) => project.reportId).length;
  const averageSimilarity = totalProjects
    ? round1(projects.reduce((total, project) => total + Number(project.highestSimilarity || 0), 0) / totalProjects)
    : 0;
  const flaggedProjects = projects.filter((project) => Number(project.highestSimilarity || 0) >= 70).length;
  const approvedProjects = projects.filter((project) => normalizeReportDecisionStatus(project.reviewDecision?.status) === 'approved').length;
  const resubmissionProjects = projects.filter((project) => normalizeReportDecisionStatus(project.reviewDecision?.status) === 'resubmit').length;
  const recentProjects = projects.slice(0, 5);

  return {
    profile: {
      displayName,
      workspace: 'Code Review Desk',
    },
    generatedAt: new Date().toISOString(),
    notifications: Math.min(9, flaggedProjects),
    metrics: [
      { label: 'Projects in Review', value: totalProjects, note: `${recentProjects.length} recent uploads`, tone: 'blue' },
      { label: 'Completed Checks', value: totalChecks, note: 'token + structure scan', tone: 'green' },
      { label: 'Mean Similarity', value: `${averageSimilarity}%`, note: 'current review set', tone: 'orange' },
      { label: 'Needs Review', value: flaggedProjects, note: '70% and above', tone: 'red' },
      { label: 'Approved', value: approvedProjects, note: 'instructor cleared', tone: 'green' },
      { label: 'Resubmission Requested', value: resubmissionProjects, note: 'needs student action', tone: 'orange' },
    ],
    trend: buildTrend(projects),
    distribution: buildDistribution(projects),
    recentChecks: recentProjects.map((project) => ({
      id: project.id,
      reportId: project.reportId,
      project: project.title,
      owner: project.owner,
      checkedOn: project.createdAt,
      score: Number(project.highestSimilarity || 0),
      status: project.reviewDecision?.label || statusFromScore(Number(project.highestSimilarity || 0)),
      reviewDecision: project.reviewDecision || null,
    })),
    topMatches: [...projects]
      .sort((a, b) => Number(b.highestSimilarity || 0) - Number(a.highestSimilarity || 0))
      .slice(0, 5)
      .map((project) => ({
        id: project.id,
        reportId: project.reportId,
        name: project.title,
        owner: project.owner,
        score: Number(project.highestSimilarity || 0),
        reviewDecision: project.reviewDecision || null,
      })),
    users,
  };
}

function buildTrend(projects) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const dayProjects = projects.filter((project) => sameDay(new Date(project.createdAt), date));
    const average = dayProjects.length
      ? dayProjects.reduce((sum, project) => sum + Number(project.highestSimilarity || 0), 0) / dayProjects.length
      : 0;
    return {
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Math.round(average),
    };
  });
}

function buildDistribution(projects) {
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
      label: bucket.label,
      count,
      percent: round1((count / total) * 100),
      color: bucket.color,
    };
  });
}

async function userIsAdmin(userId) {
  if (!supabase || !userId) return false;
  const { data } = await supabase.from('users').select('role').eq('id', userId).single();
  return data?.role === 'admin';
}

function encodeSubmissionMetadata(submission = {}) {
  return JSON.stringify({
    kind: 'student_submission',
    studentName: submission.studentName || '',
    subject: submission.subject || '',
    section: submission.section || '',
  });
}

function parseSubmissionMetadata(description) {
  if (!description) return {};
  try {
    const parsed = JSON.parse(description);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function submissionStudentName(project, user) {
  const metadata = parseSubmissionMetadata(project?.description);
  const profile = firstProfile(user);
  return metadata.studentName || profile?.full_name || profile?.email || project?.owner || 'Student';
}

function uploaderAccountName(project, user) {
  const profile = firstProfile(user);
  return profile?.full_name || profile?.email || project?.uploadedBy || project?.owner || 'Unknown account';
}

function uploaderAccountEmail(project, user) {
  const profile = firstProfile(user);
  return profile?.email || project?.uploadedByEmail || '';
}

function firstProfile(value) {
  return Array.isArray(value) ? value[0] : value;
}

function submissionDisplayName(project) {
  if (!project) return 'Unknown submission';
  const metadata = parseSubmissionMetadata(project.description);
  const owner = metadata.studentName ? `${metadata.studentName} - ` : '';
  return `${owner}${project.title}`;
}

function toSubmissionRepositoryRow(project, user) {
  const metadata = parseSubmissionMetadata(project.description);
  return {
    id: project.id,
    studentName: metadata.studentName || user?.full_name || project.studentName || project.owner || 'Student',
    subject: metadata.subject || project.subject || 'Unassigned',
    section: metadata.section || project.section || 'Unassigned',
    title: project.title,
    submissionDate: project.created_at || project.createdAt,
    fileCount: project.extracted_code_files?.length || project.files || 0,
    programmingLanguage:
      Object.keys(project.language_summary || {}).join(', ') || project.language || 'Mixed',
    uploadStatus: normalizeUploadStatus(project.status),
    highestSimilarity: Number(project.highest_similarity ?? project.highestSimilarity ?? 0),
    reportId: project.reportId || project.id,
  };
}

function normalizeUploadStatus(status) {
  if (!status) return 'Uploaded';
  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function latestReportId(reports = []) {
  return [...reports]
    .filter((report) => report.id)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0]?.id;
}

function latestReportDecision(reports = []) {
  const latestReport = [...reports]
    .filter((report) => report.id)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];

  return latestReport?.report_json?.reviewDecision || null;
}

function normalizeReportDecisionStatus(decision) {
  const status = typeof decision === 'string' ? decision : decision?.status;
  const normalizedStatus = String(status || '').trim().toLowerCase().replace(/[-_\s]+/g, '_');

  if (['approved', 'approve', 'cleared'].includes(normalizedStatus)) return 'approved';
  if (['resubmit', 'resubmission', 'resubmission_requested', 'request_resubmission'].includes(normalizedStatus)) {
    return 'resubmit';
  }

  return '';
}

function reportDecisionStatusLabel(decision) {
  const normalizedStatus = normalizeReportDecisionStatus(decision);
  if (normalizedStatus === 'approved') return 'Approved';
  if (normalizedStatus === 'resubmit') return 'Resubmission Requested';
  return '';
}

function firstLineNumber(range) {
  const [start] = String(range || '').split('-').map((value) => Number(value));
  return Number.isFinite(start) ? start : null;
}

function lastLineNumber(range) {
  const parts = String(range || '').split('-').map((value) => Number(value));
  const end = parts[1] ?? parts[0];
  return Number.isFinite(end) ? end : null;
}

function validateAuthInput({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const cleanPassword = String(password || '');

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new ApiError(400, 'A valid email address is required.');
  }

  if (!cleanPassword || cleanPassword.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters.');
  }

  return { normalizedEmail, cleanPassword };
}

function validateAccessRequestInput({ email, fullName }) {
  const normalizedEmail = normalizeEmail(email);
  const displayName = normalizeProfileName(fullName);

  if (!displayName) {
    throw new ApiError(400, 'Full name is required to request professor access.');
  }

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new ApiError(400, 'A valid institutional email address is required.');
  }

  return { normalizedEmail, displayName };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeProfileName(fullName) {
  return String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function ensureUserProfile(authUser, defaults = {}) {
  if (!authUser?.id) throw new ApiError(401, 'Authentication failed.');

  const { data: existingProfile, error: readError } = await supabase
    .from('users')
    .select('id, email, full_name, role')
    .eq('id', authUser.id)
    .maybeSingle();

  if (readError) throw readError;
  if (existingProfile) return existingProfile;

  const fullName =
    defaults.fullName ||
    authUser.user_metadata?.full_name ||
    authUser.email?.split('@')[0] ||
    'Instructor';

  const { data: profile, error } = await supabase
    .from('users')
    .upsert(
      {
        id: authUser.id,
        email: authUser.email,
        full_name: fullName,
        role: defaults.role || 'user',
      },
      { onConflict: 'id' },
    )
    .select('id, email, full_name, role')
    .single();

  if (error) throw error;
  return profile;
}

function toAuthResponse(authData, profile) {
  return {
    user: {
      id: authData.user.id,
      email: authData.user.email,
      user_metadata: {
        ...(authData.user.user_metadata || {}),
        full_name: profile?.full_name || authData.user.user_metadata?.full_name,
      },
    },
    profile: {
      fullName: profile?.full_name || authData.user.email,
      role: profile?.role || 'user',
    },
    session: {
      access_token: authData.session?.access_token,
      refresh_token: authData.session?.refresh_token,
      expires_at: authData.session?.expires_at,
      expires_in: authData.session?.expires_in,
      token_type: authData.session?.token_type || 'bearer',
    },
  };
}

function toCurrentUserProfile(profile, authUser) {
  return {
    id: profile?.id || authUser?.id,
    email: profile?.email || authUser?.email,
    fullName: profile?.full_name || authUser?.user_metadata?.full_name || authUser?.email,
    role: profile?.role || 'user',
  };
}

function normalizeAuthMessage(message = '') {
  if (message.toLowerCase().includes('invalid login')) return 'Email or password is incorrect.';
  return message || 'Authentication failed.';
}

function toAdminUser(row) {
  return {
    id: row.id,
    name: row.full_name || row.email,
    email: row.email,
    role: row.role === 'admin' ? 'Admin' : 'User',
    uploads: row.projects?.length || 0,
  };
}

function toAccessRequest(row) {
  const metadata = row?.metadata || {};
  const normalizedStatus = normalizeAccessRequestStatus(metadata.status);

  return {
    id: row.id,
    name: metadata.fullName || metadata.name || metadata.email || 'Professor',
    email: metadata.email || '',
    status: formatAccessRequestStatus(normalizedStatus),
    createdAt: row.created_at || metadata.requestedAt || new Date().toISOString(),
    reviewedAt: metadata.reviewedAt || null,
  };
}

function dedupeAccessRequests(rows = []) {
  const seenPendingEmails = new Set();
  const requests = [];

  for (const row of rows) {
    const request = toAccessRequest(row);
    const emailKey = request.email.toLowerCase();
    const isPending = request.status.toLowerCase() === 'pending';

    if (isPending && emailKey) {
      if (seenPendingEmails.has(emailKey)) continue;
      seenPendingEmails.add(emailKey);
    }

    requests.push(request);
  }

  return requests;
}

function normalizeAccessRequestStatus(status = 'pending') {
  return String(status || 'pending').trim().toLowerCase();
}

function formatAccessRequestStatus(status = 'pending') {
  const normalizedStatus = normalizeAccessRequestStatus(status);
  return normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
}

function requireAuthenticatedUser(user) {
  if (supabase && !user?.id) {
    throw new ApiError(401, 'Sign in is required.');
  }
}

function requireLocalDemoMode() {
  if (!config.enableLocalDemo) {
    throw new ApiError(503, 'Local demo storage is disabled. Configure Supabase for this environment.');
  }
}

function validateLookupId(value, label) {
  const normalized = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(normalized)) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return normalized;
}

function hydrateStoredDocument(row) {
  const normalizedTokens = row.normalized_code.split(/\s+/).filter(Boolean);
  const fingerprints = new Set(Array.isArray(row.fingerprint_hashes) ? row.fingerprint_hashes : []);
  const metadata = parseSubmissionMetadata(row.projects?.description);
  const rawCode = row.metrics?.rawCode || row.normalized_code;

  return {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.projects?.title,
    studentName: metadata.studentName,
    subject: metadata.subject,
    section: metadata.section,
    submittedAt: row.projects?.created_at,
    filePath: row.file_path,
    language: row.language,
    rawText: rawCode,
    sizeBytes: row.size_bytes,
    contentSha256: row.content_sha256,
    normalizedSha256: row.normalized_sha256,
    rawTokens: normalizedTokens,
    normalizedTokens,
    normalizedText: row.normalized_code,
    fingerprints,
    structure: {
      keywords: normalizedTokens.filter((token) => /^[a-z]+$/.test(token)),
      braces: normalizedTokens.filter((token) => '{}()[]'.includes(token)),
      maxDepth: row.metrics?.structure?.maxDepth || 0,
      lineCount: row.metrics?.structure?.lineCount || 0,
    },
    identifiers: [],
    styleFingerprint: row.metrics?.styleFingerprint || null,
  };
}

function summarizeLanguageJson(documents) {
  const summary = documents.reduce((currentSummary, document) => {
    currentSummary[document.language] = (currentSummary[document.language] || 0) + 1;
    return currentSummary;
  }, {});

  return summary;
}

function summarizeLanguageText(documents) {
  return Object.entries(summarizeLanguageJson(documents))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([language]) => language)
    .join(', ');
}

function archiveTypeFromName(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.zip') return 'zip';
  if (extension === '.rar') return 'rar';
  return 'single';
}

function safeContentType(mimeType) {
  if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
    return mimeType;
  }

  if (mimeType === 'application/vnd.rar' || mimeType === 'application/x-rar-compressed') {
    return mimeType;
  }

  return 'application/octet-stream';
}

function sanitizeStorageName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function daysAgo(days, hour, minute) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function statusFromScore(score) {
  if (score >= 81) return 'Very High';
  if (score >= 51) return 'High';
  if (score >= 21) return 'Moderate';
  return 'Low';
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function displayNameFromUser(user) {
  const rawName = user?.user_metadata?.full_name || user?.email || 'Instructor';
  if (!rawName.includes('@')) return rawName;
  return rawName
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function makeSeedReport(project) {
  const comparedTitle = 'Archived baseline submission';
  return {
    id: project.reportId,
    projectId: project.id,
    sourceSubmissionId: project.id,
    comparedSubmissionId: `archive-${project.id}`,
    projectTitle: `${project.title} vs ${comparedTitle}`,
    comparedWith: comparedTitle,
    submissionCompared: {
      source: {
        id: project.id,
        title: project.title,
        studentName: project.owner,
      },
      compared: {
        id: `archive-${project.id}`,
        title: comparedTitle,
        studentName: 'Archived Submission',
      },
    },
    similarityScore: project.highestSimilarity,
    exactMatchScore: Math.max(0, Math.round(project.highestSimilarity - 18)),
    structuralSimilarityScore: Math.max(0, Math.round(project.highestSimilarity - 6)),
    semanticSimilarityScore: Math.max(0, Math.round(project.highestSimilarity - 10)),
    variableRenameScore: Math.max(0, Math.round(project.highestSimilarity - 22)),
    generatedAt: project.createdAt,
    summary: `${project.title} was checked against the local course archive. The strongest match scored ${project.highestSimilarity.toFixed(1)}% and is marked ${project.status.toLowerCase()} for instructor review.`,
    chartData: [
      { name: 'Exact', value: Math.max(0, Math.round(project.highestSimilarity - 18)) },
      { name: 'Structure', value: Math.max(0, Math.round(project.highestSimilarity - 6)) },
      { name: 'Semantic', value: Math.max(0, Math.round(project.highestSimilarity - 10)) },
      { name: 'Renamed', value: Math.max(0, Math.round(project.highestSimilarity - 22)) },
    ],
    filePairs: [
      {
        source: 'src/main/controller.php',
        compared: 'archive/submission/controller.php',
        score: project.highestSimilarity,
        matchType: statusFromScore(project.highestSimilarity),
      },
    ],
    matchedSections: [],
    renamedVariables: [],
  };
}
