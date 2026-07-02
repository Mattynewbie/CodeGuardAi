import crypto from 'node:crypto';

export function buildReport({
  projectId,
  projectTitle,
  sourceSubmission,
  comparedSubmission,
  sourceDocuments,
  comparison,
  authorFingerprint,
}) {
  const strongestPair = comparison.filePairs[0];
  const similarityScore = comparison.projectScore;
  const source = sourceSubmission || comparison.sourceSubmission || {
    id: projectId,
    title: projectTitle,
  };
  const compared = comparedSubmission || comparison.comparedSubmission || {
    id: strongestPair?.comparedProjectId,
    title: strongestPair?.comparedProjectTitle || 'Previous submission',
  };
  const reportId = crypto.randomUUID();

  return {
    id: reportId,
    projectId,
    sourceSubmissionId: source.id,
    comparedSubmissionId: compared.id,
    projectTitle: `${source.title} vs ${compared.title}`,
    comparedWith: compared.title,
    submissionCompared: {
      source,
      compared,
    },
    similarityScore,
    exactMatchScore: comparison.metrics?.exactMatch || 0,
    tokenSimilarityScore: comparison.metrics?.tokenSimilarity || 0,
    structuralSimilarityScore: comparison.metrics?.structuralSimilarity || 0,
    semanticSimilarityScore: comparison.metrics?.semanticSimilarity || 0,
    fingerprintSimilarityScore: comparison.metrics?.fingerprintSimilarity || 0,
    variableRenameScore: comparison.metrics?.variableRename || 0,
    variableRenameDetection: {
      detected: (comparison.renamedVariables || []).length > 0 || Number(comparison.metrics?.variableRename || 0) > 0,
      score: comparison.metrics?.variableRename || 0,
    },
    generatedAt: new Date().toISOString(),
    summary: buildSummary(similarityScore, comparison.filePairs.length, source, compared),
    chartData: buildChartData(comparison.filePairs),
    filePairs: comparison.filePairs.map((pair) => ({
      sourceId: pair.sourceId,
      comparedId: pair.comparedId,
      sourceSubmissionId: source.id,
      comparedSubmissionId: compared.id,
      source: pair.source,
      compared: pair.compared,
      score: pair.score,
      matchType: pair.matchType,
      explanation: pair.explanation,
      metrics: pair.metrics,
    })),
    matchedSections: comparison.matchedSections,
    renamedVariables: comparison.renamedVariables,
    aiIntegration: comparison.aiIntegration,
    authorFingerprint: authorFingerprint || comparison.authorFingerprint || null,
    sourceFileCount: sourceDocuments.length,
  };
}

export function buildWaitingReport({ projectId, projectTitle, sourceSubmission, sourceDocuments, authorFingerprint }) {
  return {
    id: `waiting-${projectId}`,
    projectId,
    sourceSubmissionId: projectId,
    projectTitle,
    comparedWith: null,
    submissionCompared: null,
    waiting: true,
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
    generatedAt: new Date().toISOString(),
    summary: 'Waiting for another submission to compare.',
    chartData: [
      { name: 'Exact', value: 0 },
      { name: 'Structure', value: 0 },
      { name: 'Semantic', value: 0 },
      { name: 'Renamed', value: 0 },
    ],
    filePairs: [],
    matchedSections: [],
    renamedVariables: [],
    authorFingerprint: authorFingerprint || null,
    sourceFileCount: sourceDocuments.length,
    submission: sourceSubmission,
  };
}

function buildSummary(score, pairCount, source, compared) {
  const pairLabel = `${source.title} vs ${compared.title}`;

  if (score >= 80) {
    return `High similarity detected for ${pairLabel}. ${pairCount} suspicious cross-submission file pair(s) should be reviewed for copied code, renamed identifiers, and matching logic flow.`;
  }

  if (score >= 60) {
    return `Moderate similarity detected for ${pairLabel}. ${pairCount} cross-submission file pair(s) contain shared tokens, structure, or localized code sections that may need instructor review.`;
  }

  if (pairCount > 0) {
    return `Low similarity detected for ${pairLabel}, with ${pairCount} minor cross-submission file pair(s) retained as supporting evidence.`;
  }

  return `No suspicious similarity found between ${pairLabel}.`;
}

function buildChartData(filePairs) {
  if (!filePairs.length) {
    return [
      { name: 'Exact', value: 0 },
      { name: 'Structure', value: 0 },
      { name: 'Semantic', value: 0 },
      { name: 'Renamed', value: 0 },
    ];
  }

  const topPairs = filePairs.slice(0, 5);
  const average = (key) =>
    Math.round(topPairs.reduce((total, pair) => total + Number(pair.metrics[key] || 0), 0) / topPairs.length);

  return [
    { name: 'Exact', value: average('exact') },
    { name: 'Structure', value: average('structure') },
    { name: 'Semantic', value: average('semantic') || average('fingerprint') },
    { name: 'Renamed', value: average('renamedVariables') },
  ];
}
