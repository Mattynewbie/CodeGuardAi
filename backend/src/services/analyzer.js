import crypto from 'node:crypto';
import { explainSimilarity, getAiRuntimeInfo, semanticSimilarity } from './ai.js';

const keywordPattern =
  /\b(if|else|for|while|do|switch|case|try|catch|finally|return|class|interface|function|def|public|private|protected|static|async|await|new|throw|throws|extends|implements|import|from|using|namespace|foreach|lambda|select|where)\b/g;

const tokenPattern =
  /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|==={0,1}|!==|!=|<=|>=|=>|[-+*/%=&|!<>^~?:;.,()[\]{}]/g;

const identifierPattern = /^[A-Za-z_$][\w$]*$/;
const htmlBoilerplateTitlePattern = /^<\/?title>$|^<title>\s*<\/title>$/i;
const htmlBoilerplateLinkPattern = /^<link\s+rel=["']?stylesheet["']?\s+href=(["'])\1\s*>$/i;
const htmlBoilerplateScriptPattern = /^<script\s+src=(["'])\1\s*>\s*<\/script>$/i;
const htmlBoilerplateLinePatterns = [
  /^<!doctype\s+html>$/i,
  /^<html(?:\s+lang=["']?en["']?)?>$/i,
  /^<\/html>$/i,
  /^<head>$/i,
  /^<\/head>$/i,
  /^<body>$/i,
  /^<\/body>$/i,
  /^<meta\s+charset=["']?utf-8["']?\s*\/?>$/i,
  /^<meta\s+name=["']viewport["']\s+content=["']width=device-width,\s*initial-scale=1\.0["']\s*\/?>$/i,
];
const namingStyleKeys = ['camelCase', 'snake_case', 'PascalCase', 'UPPER_CASE', 'lowercase', 'mixed'];
const styleSignalWeights = {
  variableNaming: 0.14,
  functionNaming: 0.11,
  indentation: 0.1,
  bracePlacement: 0.08,
  spacing: 0.1,
  comments: 0.1,
  functionLength: 0.09,
  loopStructures: 0.08,
  conditionalStructures: 0.08,
  errorHandling: 0.06,
  databaseAccess: 0.06,
  formattingHabits: 0.1,
};
const reserved = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'try',
  'catch',
  'finally',
  'return',
  'class',
  'interface',
  'function',
  'def',
  'public',
  'private',
  'protected',
  'static',
  'async',
  'await',
  'new',
  'throw',
  'throws',
  'extends',
  'implements',
  'import',
  'from',
  'using',
  'namespace',
  'foreach',
  'lambda',
  'select',
  'where',
  'const',
  'let',
  'var',
  'int',
  'float',
  'double',
  'string',
  'boolean',
  'bool',
  'void',
  'true',
  'false',
  'null',
  'None',
]);

export function toSourceDocument(file) {
  const analysisText = removeCommonBoilerplateLines(file.rawText, file);
  const withoutComments = stripComments(analysisText);
  const rawTokens = tokenize(withoutComments);
  const normalizedTokens = normalizeTokens(rawTokens);
  const normalizedText = normalizedTokens.join(' ');
  const fingerprints = createFingerprints(normalizedTokens);
  const structure = createStructureSignature(withoutComments);
  const identifiers = rawTokens.filter((token) => identifierPattern.test(token) && !reserved.has(token));
  const styleFingerprint = createDocumentStyleFingerprint(file.rawText, {
    rawTokens,
    identifiers,
    structure,
  });

  return {
    id: crypto.randomUUID(),
    projectId: file.projectId,
    projectTitle: file.projectTitle,
    ownerId: file.ownerId,
    filePath: file.filePath,
    language: file.language,
    rawText: file.rawText,
    sizeBytes: file.sizeBytes,
    contentSha256: file.sha256,
    normalizedSha256: sha256(normalizedText),
    rawTokens,
    normalizedTokens,
    normalizedText,
    fingerprints,
    structure,
    identifiers,
    styleFingerprint,
  };
}

export async function analyzeSubmission(sourceDocuments, corpusDocuments, { sourceSubmission } = {}) {
  const sourceSubmissionIds = new Set(sourceDocuments.map((document) => document.projectId));
  const previousSubmissions = groupDocumentsBySubmission(corpusDocuments).filter(
    (submission) => !sourceSubmissionIds.has(submission.id),
  );

  const comparisons = [];

  for (const previousSubmission of previousSubmissions) {
    comparisons.push(
      await compareSubmissionPair(sourceDocuments, previousSubmission.documents, {
        sourceSubmission,
        comparedSubmission: previousSubmission,
      }),
    );
  }

  const sortedComparisons = comparisons.sort((a, b) => b.projectScore - a.projectScore);
  const strongestComparison = sortedComparisons[0];
  const authorFingerprint = analyzeAuthorFingerprint(sourceDocuments, corpusDocuments, sourceSubmission);

  return {
    waiting: sortedComparisons.length === 0,
    projectScore: strongestComparison?.projectScore || 0,
    comparisons: sortedComparisons.map((comparison) => ({
      ...comparison,
      authorFingerprint,
    })),
    filePairs: strongestComparison?.filePairs || [],
    matchedSections: strongestComparison?.matchedSections || [],
    renamedVariables: strongestComparison?.renamedVariables || [],
    aiIntegration: getAiRuntimeInfo(),
    authorFingerprint,
  };
}

export async function analyzeProject(sourceDocuments, corpusDocuments) {
  return analyzeSubmission(sourceDocuments, corpusDocuments);
}

async function compareSubmissionPair(sourceDocuments, comparedDocuments, { sourceSubmission, comparedSubmission }) {
  const filePairs = [];
  const matchedSections = [];
  const renamedVariables = [];
  let boilerplateOnlyMatches = 0;

  for (const sourceDocument of sourceDocuments) {
    for (const comparedDocument of comparedDocuments) {
      if (sourceDocument.projectId === comparedDocument.projectId) continue;

      const metrics = compareDocuments(sourceDocument, comparedDocument);
      if (metrics.combinedScore < 0.35) {
        if (hasCommonHtmlBoilerplateOverlap(sourceDocument, comparedDocument)) boilerplateOnlyMatches += 1;
        continue;
      }

      const semanticScore = await semanticSimilarity(sourceDocument, comparedDocument);
      const finalScore = combineScores(metrics, semanticScore);
      const pairMatches = findMatchedSections(sourceDocument, comparedDocument, finalScore, metrics);
      const renameHints = findRenamedVariables(sourceDocument, comparedDocument, metrics);

      filePairs.push({
        sourceId: sourceDocument.id,
        comparedId: comparedDocument.id,
        sourceProjectId: sourceDocument.projectId,
        comparedProjectId: comparedDocument.projectId,
        sourceProjectTitle: sourceSubmission?.title || sourceDocument.projectTitle || 'New submission',
        comparedProjectTitle: comparedDocument.projectTitle || comparedSubmission?.title || 'Previous submission',
        source: sourceDocument.filePath,
        compared: comparedDocument.filePath,
        score: Math.round(finalScore * 100),
        metrics: toPercentMetrics(metrics, semanticScore),
        matchType: classifyMatch(metrics, semanticScore),
        explanation: explainSimilarity(metrics, semanticScore),
      });

      matchedSections.push(...pairMatches);
      renamedVariables.push(...renameHints);
    }
  }

  const sortedPairs = filePairs.sort((a, b) => b.score - a.score).slice(0, 20);
  const projectScore = calculateProjectScore(sortedPairs);
  const pairMetrics = aggregatePairMetrics(sortedPairs);

  return {
    sourceSubmission,
    comparedSubmission: comparedSubmission?.submission || comparedSubmission,
    projectScore,
    boilerplateOnlyMatch: sortedPairs.length === 0 && boilerplateOnlyMatches > 0,
    metrics: pairMetrics,
    filePairs: sortedPairs,
    matchedSections: matchedSections.slice(0, 12),
    renamedVariables: dedupeRenameHints(renamedVariables).slice(0, 12),
    aiIntegration: getAiRuntimeInfo(),
  };
}

function groupDocumentsBySubmission(documents) {
  const grouped = new Map();

  for (const document of documents) {
    if (!document.projectId) continue;
    if (!grouped.has(document.projectId)) {
      grouped.set(document.projectId, {
        id: document.projectId,
        title: document.projectTitle || 'Previous submission',
        studentName: document.studentName,
        subject: document.subject,
        section: document.section,
        submittedAt: document.submittedAt,
        documents: [],
      });
    }
    grouped.get(document.projectId).documents.push(document);
  }

  return Array.from(grouped.values());
}

export function analyzeAuthorFingerprint(sourceDocuments = [], corpusDocuments = [], sourceSubmission = {}) {
  const sourceProjectIds = new Set(sourceDocuments.map((document) => document.projectId).filter(Boolean));
  const sourceAuthorKey = normalizeAuthorName(
    sourceSubmission.studentName || sourceDocuments.find((document) => document.studentName)?.studentName,
  );

  const historyDocuments = corpusDocuments.filter((document) => {
    if (!document?.projectId || sourceProjectIds.has(document.projectId)) return false;
    return sourceAuthorKey && normalizeAuthorName(document.studentName) === sourceAuthorKey;
  });
  const historicalSubmissionCount = new Set(historyDocuments.map((document) => document.projectId)).size;
  const sourceProfile = createAuthorStyleProfile(sourceDocuments);

  if (!sourceAuthorKey || historicalSubmissionCount === 0) {
    return {
      feature: 'Code Author Fingerprint Analysis',
      available: false,
      authorName: sourceSubmission.studentName || 'Student',
      historicalSubmissionCount,
      historicalFileCount: historyDocuments.length,
      authorConsistencyScore: null,
      styleDeviation: 'Insufficient History',
      styleDeviationLevel: 'Insufficient History',
      recommendation:
        'Collect more submissions from this student before using author-style consistency as review evidence.',
      aiAnalysis:
        'There are not enough previous submissions from this student to build a reliable coding-style fingerprint. This section is advisory and should not be used to make an authorship judgment.',
      signals: [],
      sourceProfile: summarizeAuthorStyleProfile(sourceProfile),
      historyProfile: null,
    };
  }

  const historyProfile = createAuthorStyleProfile(historyDocuments);
  const signals = compareAuthorStyleProfiles(sourceProfile, historyProfile);
  const authorConsistencyScore = Math.round(
    signals.reduce((total, signal) => total + signal.score * signal.weight, 0) /
      signals.reduce((total, signal) => total + signal.weight, 0),
  );
  const styleDeviationLevel = styleDeviationFromScore(authorConsistencyScore);
  const styleDeviation = `${styleDeviationLevel} Style Deviation`;

  return {
    feature: 'Code Author Fingerprint Analysis',
    available: true,
    authorName: sourceSubmission.studentName || 'Student',
    historicalSubmissionCount,
    historicalFileCount: historyDocuments.length,
    authorConsistencyScore,
    styleDeviation,
    styleDeviationLevel,
    recommendation: recommendationForStyleDeviation(styleDeviationLevel),
    aiAnalysis: buildAuthorFingerprintExplanation({
      authorConsistencyScore,
      styleDeviationLevel,
      signals,
      historicalSubmissionCount,
    }),
    signals: signals.map(({ key, name, score, sourceStyle, historyStyle }) => ({
      key,
      name,
      score,
      sourceStyle,
      historyStyle,
    })),
    sourceProfile: summarizeAuthorStyleProfile(sourceProfile),
    historyProfile: summarizeAuthorStyleProfile(historyProfile),
  };
}

export function createAuthorStyleProfile(documents = []) {
  const fingerprints = documents
    .map((document) =>
      document.styleFingerprint ||
      createDocumentStyleFingerprint(document.rawText || document.normalizedText || '', {
        identifiers: document.identifiers || [],
        structure: document.structure,
      }),
    )
    .filter(Boolean);

  return {
    documentCount: fingerprints.length,
    features: {
      variableNaming: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.variableNaming)),
      functionNaming: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.functionNaming)),
      indentation: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.indentation)),
      bracePlacement: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.bracePlacement)),
      spacing: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.spacing)),
      comments: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.comments)),
      functionLength: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.functionLength)),
      loopStructures: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.loopStructures)),
      conditionalStructures: averageObjects(
        fingerprints.map((fingerprint) => fingerprint.features.conditionalStructures),
      ),
      errorHandling: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.errorHandling)),
      databaseAccess: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.databaseAccess)),
      formattingHabits: averageObjects(fingerprints.map((fingerprint) => fingerprint.features.formattingHabits)),
    },
  };
}

export function createDocumentStyleFingerprint(source = '', context = {}) {
  const rawText = String(source || '');
  const lines = rawText.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim());
  const codeLines = nonEmptyLines.filter((line) => !isCommentOnlyLine(line));
  const withoutComments = stripComments(rawText);
  const rawTokens = context.rawTokens || tokenize(withoutComments);
  const identifiers =
    context.identifiers || rawTokens.filter((token) => identifierPattern.test(token) && !reserved.has(token));
  const functionNames = extractFunctionNames(rawText);
  const strippedLower = withoutComments.toLowerCase();

  return {
    lineCount: codeLines.length,
    features: {
      variableNaming: namingDistribution(identifiers),
      functionNaming: namingDistribution(functionNames),
      indentation: indentationStyle(lines),
      bracePlacement: bracePlacementStyle(lines),
      spacing: spacingStyle(rawText),
      comments: commentStyle(rawText, lines),
      functionLength: functionLengthStyle(lines),
      loopStructures: keywordDistribution(strippedLower, {
        forLoop: /\bfor\s*\(/g,
        foreachLoop: /\bforeach\b|\bfor\s*\([^)]*\b(of|in)\b/g,
        whileLoop: /\bwhile\s*\(/g,
        doWhileLoop: /\bdo\b/g,
      }),
      conditionalStructures: keywordDistribution(strippedLower, {
        ifStatement: /\bif\s*\(/g,
        elseIf: /\belse\s+if\b|\belif\b/g,
        switchStatement: /\bswitch\s*\(/g,
        ternary: /\?/g,
      }),
      errorHandling: keywordDistribution(strippedLower, {
        tryBlock: /\btry\b/g,
        catchBlock: /\bcatch\b|\bexcept\b/g,
        throwStatement: /\bthrow\b|\braise\b/g,
        finallyBlock: /\bfinally\b/g,
      }),
      databaseAccess: keywordDistribution(strippedLower, {
        sqlStatement: /\b(select|insert|update|delete|join|where)\b/g,
        queryCall: /\b(query|execute|fetch|prepare)\s*\(/g,
        ormAccess: /\b(prisma|sequelize|typeorm|eloquent|supabase|mongoose)\b/g,
        connectionAccess: /\b(pdo|mysqli|connection|database|db)\b/g,
      }),
      formattingHabits: formattingHabits(rawText, codeLines, rawTokens),
    },
  };
}

function compareAuthorStyleProfiles(sourceProfile, historyProfile) {
  const source = sourceProfile.features;
  const history = historyProfile.features;

  return [
    makeStyleSignal({
      key: 'variableNaming',
      name: 'Variable naming',
      score: distributionSimilarity(source.variableNaming, history.variableNaming),
      sourceStyle: dominantNamingStyle(source.variableNaming),
      historyStyle: dominantNamingStyle(history.variableNaming),
    }),
    makeStyleSignal({
      key: 'functionNaming',
      name: 'Function and method naming',
      score: distributionSimilarity(source.functionNaming, history.functionNaming),
      sourceStyle: dominantNamingStyle(source.functionNaming),
      historyStyle: dominantNamingStyle(history.functionNaming),
    }),
    makeStyleSignal({
      key: 'indentation',
      name: 'Indentation style',
      score: distributionSimilarity(source.indentation, history.indentation),
      sourceStyle: describeIndentation(source.indentation),
      historyStyle: describeIndentation(history.indentation),
    }),
    makeStyleSignal({
      key: 'bracePlacement',
      name: 'Brace placement',
      score: distributionSimilarity(source.bracePlacement, history.bracePlacement),
      sourceStyle: describeBracePlacement(source.bracePlacement),
      historyStyle: describeBracePlacement(history.bracePlacement),
    }),
    makeStyleSignal({
      key: 'spacing',
      name: 'Spacing around syntax',
      score: distributionSimilarity(source.spacing, history.spacing),
      sourceStyle: describeSpacing(source.spacing),
      historyStyle: describeSpacing(history.spacing),
    }),
    makeStyleSignal({
      key: 'comments',
      name: 'Comment frequency and style',
      score: distributionSimilarity(source.comments, history.comments),
      sourceStyle: describeComments(source.comments),
      historyStyle: describeComments(history.comments),
    }),
    makeStyleSignal({
      key: 'functionLength',
      name: 'Average function length',
      score: distributionSimilarity(source.functionLength, history.functionLength),
      sourceStyle: describeFunctionLength(source.functionLength),
      historyStyle: describeFunctionLength(history.functionLength),
    }),
    makeStyleSignal({
      key: 'loopStructures',
      name: 'Preferred loop structures',
      score: distributionSimilarity(source.loopStructures, history.loopStructures),
      sourceStyle: dominantKeywordStyle(source.loopStructures, 'loop'),
      historyStyle: dominantKeywordStyle(history.loopStructures, 'loop'),
    }),
    makeStyleSignal({
      key: 'conditionalStructures',
      name: 'Preferred conditional structures',
      score: distributionSimilarity(source.conditionalStructures, history.conditionalStructures),
      sourceStyle: dominantKeywordStyle(source.conditionalStructures, 'conditional'),
      historyStyle: dominantKeywordStyle(history.conditionalStructures, 'conditional'),
    }),
    makeStyleSignal({
      key: 'errorHandling',
      name: 'Error handling patterns',
      score: distributionSimilarity(source.errorHandling, history.errorHandling),
      sourceStyle: dominantKeywordStyle(source.errorHandling, 'error handling'),
      historyStyle: dominantKeywordStyle(history.errorHandling, 'error handling'),
    }),
    makeStyleSignal({
      key: 'databaseAccess',
      name: 'Database access patterns',
      score: distributionSimilarity(source.databaseAccess, history.databaseAccess),
      sourceStyle: dominantKeywordStyle(source.databaseAccess, 'data access'),
      historyStyle: dominantKeywordStyle(history.databaseAccess, 'data access'),
    }),
    makeStyleSignal({
      key: 'formattingHabits',
      name: 'Formatting habits',
      score: distributionSimilarity(source.formattingHabits, history.formattingHabits),
      sourceStyle: describeFormatting(source.formattingHabits),
      historyStyle: describeFormatting(history.formattingHabits),
    }),
  ];
}

function makeStyleSignal({ key, name, score, sourceStyle, historyStyle }) {
  return {
    key,
    name,
    score: Math.round(score),
    weight: styleSignalWeights[key] || 0.08,
    sourceStyle,
    historyStyle,
  };
}

function namingDistribution(identifiers = []) {
  const counts = Object.fromEntries(namingStyleKeys.map((key) => [key, 0]));
  const usableIdentifiers = identifiers.filter((identifier) => identifier && !reserved.has(identifier));

  for (const identifier of usableIdentifiers) {
    counts[classifyNamingStyle(identifier)] += 1;
  }

  return normalizeCounts(counts);
}

function classifyNamingStyle(identifier) {
  if (/^[a-z][a-z0-9]*([A-Z][A-Za-z0-9]*)+$/.test(identifier)) return 'camelCase';
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(identifier)) return 'snake_case';
  if (/^[A-Z][A-Za-z0-9]*$/.test(identifier) && /[a-z]/.test(identifier)) return 'PascalCase';
  if (/^[A-Z][A-Z0-9_]*$/.test(identifier) && /[A-Z]/.test(identifier)) return 'UPPER_CASE';
  if (/^[a-z][a-z0-9]*$/.test(identifier)) return 'lowercase';
  return 'mixed';
}

function indentationStyle(lines) {
  const indentedLines = lines.filter((line) => line.trim() && /^\s+/.test(line));
  const tabLines = indentedLines.filter((line) => /^\t+/.test(line)).length;
  const spaceIndents = indentedLines
    .map((line) => line.match(/^ +/)?.[0].length || 0)
    .filter((length) => length > 0);
  const twoSpaceLines = spaceIndents.filter((length) => length % 2 === 0 && length % 4 !== 0).length;
  const fourSpaceLines = spaceIndents.filter((length) => length % 4 === 0).length;
  const total = indentedLines.length || 1;

  return {
    tabRatio: tabLines / total,
    spaceRatio: spaceIndents.length / total,
    twoSpaceRatio: twoSpaceLines / total,
    fourSpaceRatio: fourSpaceLines / total,
    averageIndent: Math.min(1, average(spaceIndents) / 16),
  };
}

function bracePlacementStyle(lines) {
  let sameLine = 0;
  let nextLine = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes('{')) continue;
    if (/^\{/.test(trimmed)) nextLine += 1;
    else sameLine += 1;
  }

  return normalizeCounts({
    sameLine,
    nextLine,
  });
}

function spacingStyle(source) {
  const operators = source.match(/===|!==|==|!=|<=|>=|=>|\+=|-=|\*=|\/=|%=|(?<![A-Za-z0-9_$])[=+\-*/%<>](?![A-Za-z0-9_$])/g) || [];
  const spacedOperators =
    source.match(/\s(?:===|!==|==|!=|<=|>=|=>|\+=|-=|\*=|\/=|%=|[=+\-*/%<>])\s/g) || [];
  const commaMatches = source.match(/,/g) || [];
  const commaSpaceMatches = source.match(/,\s/g) || [];
  const parens = source.match(/[()]/g) || [];
  const paddedParens = source.match(/\(\s+|\s+\)/g) || [];
  const callableSpace = source.match(/\b[A-Za-z_$][\w$]*\s+\(/g) || [];

  return {
    spacedOperatorRatio: ratio(spacedOperators.length, operators.length),
    compactOperatorRatio: 1 - ratio(spacedOperators.length, operators.length),
    commaSpaceRatio: ratio(commaSpaceMatches.length, commaMatches.length),
    paddedParenRatio: ratio(paddedParens.length, parens.length),
    callableSpaceRatio: ratio(callableSpace.length, parens.length),
  };
}

function commentStyle(source, lines) {
  const lineComments = [
    ...Array.from(source.matchAll(/(^|[^:])\/\/(.*)$/gm), (match) => match[2] || ''),
    ...Array.from(source.matchAll(/^\s*#(.*)$/gm), (match) => match[1] || ''),
  ];
  const blockComments = Array.from(source.matchAll(/\/\*([\s\S]*?)\*\//g), (match) => match[1] || '');
  const comments = [...lineComments, ...blockComments].map((comment) => comment.trim()).filter(Boolean);
  const averageLength = average(comments.map((comment) => comment.length));
  const sentenceLike = comments.filter((comment) => /[.!?]$/.test(comment)).length;
  const capitalized = comments.filter((comment) => /^[A-Z]/.test(comment)).length;

  return {
    commentLineRatio: ratio(comments.length, lines.filter((line) => line.trim()).length),
    inlineCommentRatio: ratio(lineComments.length, comments.length),
    blockCommentRatio: ratio(blockComments.length, comments.length),
    averageCommentLength: Math.min(1, averageLength / 120),
    sentenceCommentRatio: ratio(sentenceLike, comments.length),
    capitalizedCommentRatio: ratio(capitalized, comments.length),
  };
}

function functionLengthStyle(lines) {
  const starts = [];

  lines.forEach((line, index) => {
    if (looksLikeFunctionStart(line)) starts.push(index);
  });

  if (!starts.length) {
    return {
      functionDensity: 0,
      averageFunctionLength: Math.min(1, lines.filter((line) => line.trim()).length / 80),
      shortFunctionRatio: 0,
      longFunctionRatio: 0,
    };
  }

  const lengths = starts.map((start, index) => {
    const nextStart = starts[index + 1] ?? lines.length;
    return Math.max(1, nextStart - start);
  });

  return {
    functionDensity: Math.min(1, starts.length / Math.max(1, lines.filter((line) => line.trim()).length / 20)),
    averageFunctionLength: Math.min(1, average(lengths) / 80),
    shortFunctionRatio: ratio(lengths.filter((length) => length <= 12).length, lengths.length),
    longFunctionRatio: ratio(lengths.filter((length) => length >= 45).length, lengths.length),
  };
}

function formattingHabits(source, codeLines, rawTokens) {
  const semicolons = source.match(/;/g) || [];
  const trailingCommas = source.match(/,\s*[\]}]/g) || [];
  const assignmentTokens = rawTokens.filter((token) => ['=', '=>'].includes(token));
  const asyncTokens = rawTokens.filter((token) => ['async', 'await'].includes(token));
  const classTokens = rawTokens.filter((token) => token === 'class');
  const functionTokens = rawTokens.filter((token) => ['function', 'def'].includes(token));

  return {
    semicolonLineRatio: ratio(semicolons.length, codeLines.length),
    trailingCommaRatio: ratio(trailingCommas.length, codeLines.length),
    assignmentDensity: Math.min(1, assignmentTokens.length / Math.max(1, codeLines.length)),
    asyncAwaitDensity: Math.min(1, asyncTokens.length / Math.max(1, codeLines.length)),
    classToFunctionRatio: ratio(classTokens.length, classTokens.length + functionTokens.length),
  };
}

function keywordDistribution(source, patterns) {
  const counts = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    counts[key] = (source.match(pattern) || []).length;
  }
  return normalizeCounts(counts);
}

function extractFunctionNames(source) {
  const names = new Set();
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,
    /\bdef\s+([A-Za-z_][\w]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name && identifierPattern.test(name) && !reserved.has(name)) names.add(name);
    }
  }

  return Array.from(names);
}

function looksLikeFunctionStart(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/\b(function|def)\s+[A-Za-z_$]/.test(trimmed)) return true;
  if (/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=.*=>/.test(trimmed)) return true;
  if (/^(public|private|protected|static|async|\s)*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(trimmed)) {
    return !/^(if|for|while|switch|catch)\b/.test(trimmed);
  }
  return false;
}

function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function averageObjects(objects) {
  const usableObjects = objects.filter(Boolean);
  const keys = new Set(usableObjects.flatMap((object) => Object.keys(object)));
  const averaged = {};

  for (const key of keys) {
    averaged[key] = average(usableObjects.map((object) => Number(object[key] || 0)));
  }

  return averaged;
}

function normalizeCounts(counts) {
  const total = Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
  if (!total) return Object.fromEntries(Object.keys(counts).map((key) => [key, 0]));
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, Number(count || 0) / total]));
}

function distributionSimilarity(distributionA = {}, distributionB = {}) {
  const keys = new Set([...Object.keys(distributionA), ...Object.keys(distributionB)]);
  const totalA = Array.from(keys).reduce((sum, key) => sum + Math.abs(Number(distributionA[key] || 0)), 0);
  const totalB = Array.from(keys).reduce((sum, key) => sum + Math.abs(Number(distributionB[key] || 0)), 0);

  if (!totalA && !totalB) return 100;
  if (!totalA || !totalB) return 45;

  let distance = 0;
  let overlap = 0;
  let union = 0;
  for (const key of keys) {
    const a = Math.abs(Number(distributionA[key] || 0));
    const b = Math.abs(Number(distributionB[key] || 0));
    distance += Math.abs(a - b);
    overlap += Math.min(a, b);
    union += Math.max(a, b);
  }

  const averageCloseness = Math.max(0, 1 - distance / keys.size);
  const overlapCloseness = union ? overlap / union : 0;
  return Math.max(0, (averageCloseness * 0.55 + overlapCloseness * 0.45) * 100);
}

function summarizeAuthorStyleProfile(profile) {
  if (!profile?.features) return null;
  return {
    documentCount: profile.documentCount || 0,
    variableNaming: dominantNamingStyle(profile.features.variableNaming),
    functionNaming: dominantNamingStyle(profile.features.functionNaming),
    indentation: describeIndentation(profile.features.indentation),
    bracePlacement: describeBracePlacement(profile.features.bracePlacement),
    comments: describeComments(profile.features.comments),
    functionLength: describeFunctionLength(profile.features.functionLength),
    formatting: describeFormatting(profile.features.formattingHabits),
  };
}

function styleDeviationFromScore(score) {
  if (score >= 75) return 'Low';
  if (score >= 50) return 'Moderate';
  return 'High';
}

function recommendationForStyleDeviation(level) {
  if (level === 'Low') {
    return 'Coding style is broadly consistent with the student history. Keep this as supporting context alongside similarity evidence.';
  }
  if (level === 'Moderate') {
    return 'Some coding-style differences were detected. Instructor review is recommended before drawing any conclusion.';
  }
  return 'Significant coding-style differences were detected. Manual instructor review is strongly recommended; this score must not automatically determine guilt or plagiarism.';
}

function buildAuthorFingerprintExplanation({ authorConsistencyScore, styleDeviationLevel, signals, historicalSubmissionCount }) {
  const sortedSignals = [...signals].sort((a, b) => a.score - b.score);
  const weakSignals = sortedSignals.filter((signal) => signal.score < 65).slice(0, 4);
  const strongSignals = [...signals].filter((signal) => signal.score >= 78).slice(0, 4);
  const weakText = listSignalNames(weakSignals);
  const strongText = listSignalNames(strongSignals);
  const historyText = `${historicalSubmissionCount} previous submission${historicalSubmissionCount === 1 ? '' : 's'}`;

  if (styleDeviationLevel === 'Low') {
    return `The submitted project closely matches the student's historical coding style across ${historyText}. ${strongText || 'Naming, formatting, control-flow, and structure habits'} remain consistent. This evidence is advisory and should be reviewed together with the similarity report.`;
  }

  if (styleDeviationLevel === 'Moderate') {
    return `The submitted project is partly consistent with the student's previous work, but noticeable differences appear in ${weakText || 'several style signals'}. Manual instructor review is recommended before making any authorship or plagiarism judgment.`;
  }

  return `The submitted project shows significant differences from the student's previous coding style, especially in ${weakText || 'naming, formatting, and code-organization patterns'}. Manual instructor review is strongly recommended. This analysis assists review only and must not automatically determine guilt or plagiarism.`;
}

function listSignalNames(signals) {
  if (!signals.length) return '';
  if (signals.length === 1) return signals[0].name.toLowerCase();
  const names = signals.map((signal) => signal.name.toLowerCase());
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

function dominantNamingStyle(distribution = {}) {
  const [style, value] = dominantEntry(distribution);
  if (!style || value === 0) return 'not enough naming evidence';
  return style;
}

function describeIndentation(indentation = {}) {
  if (Number(indentation.tabRatio || 0) >= 0.5) return 'tabs';
  if (Number(indentation.fourSpaceRatio || 0) >= Number(indentation.twoSpaceRatio || 0)) return '4-space indents';
  if (Number(indentation.twoSpaceRatio || 0) > 0) return '2-space indents';
  return 'minimal indentation evidence';
}

function describeBracePlacement(braces = {}) {
  if (Number(braces.nextLine || 0) > Number(braces.sameLine || 0)) return 'next-line braces';
  if (Number(braces.sameLine || 0) > 0) return 'same-line braces';
  return 'limited brace evidence';
}

function describeSpacing(spacing = {}) {
  if (Number(spacing.spacedOperatorRatio || 0) >= 0.65) return 'spaced operators';
  if (Number(spacing.compactOperatorRatio || 0) >= 0.65) return 'compact operators';
  return 'mixed spacing';
}

function describeComments(comments = {}) {
  const frequency = Number(comments.commentLineRatio || 0);
  if (frequency >= 0.25) return 'frequent comments';
  if (frequency >= 0.08) return 'moderate comments';
  return 'sparse comments';
}

function describeFunctionLength(functionLength = {}) {
  const averageFunctionLength = Number(functionLength.averageFunctionLength || 0) * 80;
  if (!averageFunctionLength) return 'limited function evidence';
  if (averageFunctionLength <= 12) return 'short functions';
  if (averageFunctionLength >= 45) return 'long functions';
  return 'medium-length functions';
}

function describeFormatting(formatting = {}) {
  if (Number(formatting.semicolonLineRatio || 0) >= 0.45) return 'semicolon-heavy formatting';
  if (Number(formatting.asyncAwaitDensity || 0) >= 0.15) return 'async-oriented formatting';
  return 'light semicolon formatting';
}

function dominantKeywordStyle(distribution = {}, fallback) {
  const [style, value] = dominantEntry(distribution);
  if (!style || value === 0) return `limited ${fallback} evidence`;
  return style.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function dominantEntry(object = {}) {
  return Object.entries(object).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0] || [null, 0];
}

function normalizeAuthorName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function ratio(part, total) {
  if (!total) return 0;
  return Math.min(1, Math.max(0, part / total));
}

function average(values = []) {
  const usableValues = values.map(Number).filter((value) => Number.isFinite(value));
  if (!usableValues.length) return 0;
  return usableValues.reduce((sum, value) => sum + value, 0) / usableValues.length;
}

function aggregatePairMetrics(filePairs) {
  if (!filePairs.length) {
    return {
      exactMatch: 0,
      tokenSimilarity: 0,
      structuralSimilarity: 0,
      semanticSimilarity: 0,
      fingerprintSimilarity: 0,
      variableRename: 0,
    };
  }

  const topPairs = filePairs.slice(0, 5);
  const average = (key) =>
    Math.round(topPairs.reduce((total, pair) => total + Number(pair.metrics[key] || 0), 0) / topPairs.length);

  return {
    exactMatch: average('exact'),
    tokenSimilarity: average('tokens'),
    structuralSimilarity: average('structure'),
    semanticSimilarity: average('semantic') || average('fingerprint'),
    fingerprintSimilarity: average('fingerprint'),
    variableRename: average('renamedVariables'),
  };
}

export function compareDocuments(documentA, documentB) {
  const hasMeaningfulContent = hasMeaningfulComparableContent(documentA) || hasMeaningfulComparableContent(documentB);
  const exactFullContentScore = exactFullContentMatch(documentA, documentB) ? 1 : 0;
  const exactLineScore = exactLineMatch(documentA, documentB) ? 1 : 0;
  if (exactFullContentScore || exactLineScore) {
    return makeExactDocumentMetrics({ exactFullContentScore, exactLineScore });
  }

  const exactScore =
    hasMeaningfulContent &&
    (documentA.contentSha256 === documentB.contentSha256 ||
      documentA.normalizedSha256 === documentB.normalizedSha256)
      ? 1
      : 0;
  const rawTokenScore = cosineSimilarity(documentA.rawTokens, documentB.rawTokens);
  const tokenScore = cosineSimilarity(documentA.normalizedTokens, documentB.normalizedTokens);
  const fingerprintScore = jaccard(documentA.fingerprints, documentB.fingerprints);
  const structureScore = structureSimilarity(documentA.structure, documentB.structure);
  const stringScore = normalizedStringSimilarity(documentA.normalizedText, documentB.normalizedText);
  const renamedVariableScore = Math.max(0, tokenScore - rawTokenScore);
  const nearDuplicateScore = calculateNearDuplicateScore({ tokenScore, fingerprintScore, structureScore, stringScore });
  const shortFileBoostScore = calculateShortFileBoostScore({
    documentA,
    documentB,
    tokenScore,
    rawTokenScore,
    stringScore,
  });

  const combinedScore = Math.max(
    exactScore,
    nearDuplicateScore,
    shortFileBoostScore,
    exactScore * 0.2 +
      fingerprintScore * 0.3 +
      tokenScore * 0.25 +
      structureScore * 0.2 +
      stringScore * 0.05 +
      renamedVariableScore * 0.1,
  );

  return {
    exactScore,
    exactFullContentScore,
    exactLineScore,
    rawTokenScore,
    tokenScore,
    fingerprintScore,
    structureScore,
    stringScore,
    renamedVariableScore,
    nearDuplicateScore,
    shortFileBoostScore,
    combinedScore,
  };
}

function combineScores(metrics, semanticScore) {
  if (typeof semanticScore !== 'number') return metrics.combinedScore;

  return Math.max(
    metrics.combinedScore,
    metrics.nearDuplicateScore || 0,
    metrics.shortFileBoostScore || 0,
    metrics.exactScore * 0.18 +
      metrics.fingerprintScore * 0.25 +
      metrics.tokenScore * 0.22 +
      metrics.structureScore * 0.18 +
      semanticScore * 0.17,
  );
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/#.*$/gm, ' ');
}

function tokenize(source) {
  return source.match(tokenPattern) || [];
}

function normalizeTokens(tokens) {
  const identifierMap = new Map();
  let identifierCount = 0;

  return tokens.map((token) => {
    if (/^\d/.test(token)) return 'NUM';
    if (!identifierPattern.test(token) || reserved.has(token)) return token;

    if (!identifierMap.has(token)) {
      identifierCount += 1;
      identifierMap.set(token, `ID${identifierCount}`);
    }
    return identifierMap.get(token);
  });
}

function createFingerprints(tokens, windowSize = 7) {
  if (!tokens.length) return new Set();
  if (tokens.length < windowSize) return new Set([sha256(tokens.join(' ')).slice(0, 16)]);
  const fingerprints = new Set();

  for (let index = 0; index <= tokens.length - windowSize; index += 1) {
    const gram = tokens.slice(index, index + windowSize).join(' ');
    fingerprints.add(sha256(gram).slice(0, 16));
  }

  return fingerprints;
}

function createStructureSignature(source) {
  const keywords = source.match(keywordPattern) || [];
  const braces = source.match(/[{}()[\]]/g) || [];
  const maxDepth = calculateMaxBraceDepth(source);
  const lineCount = source.split(/\r?\n/).filter((line) => line.trim()).length;

  return {
    keywords,
    braces,
    maxDepth,
    lineCount,
  };
}

function calculateMaxBraceDepth(source) {
  let depth = 0;
  let maxDepth = 0;
  for (const char of source) {
    if (char === '{' || char === '(' || char === '[') {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
    } else if (char === '}' || char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
    }
  }
  return maxDepth;
}

function cosineSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const vectorA = termFrequency(tokensA);
  const vectorB = termFrequency(tokensB);
  const terms = new Set([...vectorA.keys(), ...vectorB.keys()]);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const term of terms) {
    const a = vectorA.get(term) || 0;
    const b = vectorB.get(term) || 0;
    dot += a * b;
    normA += a ** 2;
    normB += b ** 2;
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function termFrequency(tokens) {
  const frequency = new Map();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  return frequency;
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function structureSimilarity(structureA, structureB) {
  const keywordScore = cosineSimilarity(structureA.keywords, structureB.keywords);
  const braceScore = cosineSimilarity(structureA.braces, structureB.braces);
  const depthScore = closeness(structureA.maxDepth, structureB.maxDepth);
  const lineScore = closeness(structureA.lineCount, structureB.lineCount);

  return keywordScore * 0.45 + braceScore * 0.2 + depthScore * 0.2 + lineScore * 0.15;
}

function closeness(a, b) {
  if (a === 0 && b === 0) return 1;
  return 1 - Math.abs(a - b) / Math.max(a, b, 1);
}

function makeExactDocumentMetrics({ exactFullContentScore = 1, exactLineScore = 1 } = {}) {
  return {
    exactScore: 1,
    exactFullContentScore,
    exactLineScore,
    rawTokenScore: 1,
    tokenScore: 1,
    fingerprintScore: 1,
    structureScore: 1,
    stringScore: 1,
    renamedVariableScore: 0,
    nearDuplicateScore: 1,
    shortFileBoostScore: 1,
    combinedScore: 1,
  };
}

function exactFullContentMatch(documentA, documentB) {
  if (!hasMeaningfulComparableContent(documentA) && !hasMeaningfulComparableContent(documentB)) return false;
  const first = normalizeFullContent(documentA.rawText || documentA.normalizedText);
  const second = normalizeFullContent(documentB.rawText || documentB.normalizedText);
  return Boolean(first && second && first === second);
}

function exactLineMatch(documentA, documentB) {
  if (!hasMeaningfulComparableContent(documentA) && !hasMeaningfulComparableContent(documentB)) return false;
  const first = normalizeComparableLines(documentA.rawText || documentA.normalizedText);
  const second = normalizeComparableLines(documentB.rawText || documentB.normalizedText);
  if (!first.length || first.length !== second.length) return false;
  return first.every((line, index) => line === second[index]);
}

function normalizeFullContent(source) {
  return String(source || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function normalizeComparableLines(source) {
  const text = normalizeFullContent(source);
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasMeaningfulComparableContent(document) {
  return removeCommonBoilerplateLines(document.rawText || document.normalizedText, document).trim().length > 0;
}

function removeCommonBoilerplateLines(source, file = {}) {
  if (!isHtmlLikeFile(file)) return String(source || '');

  return String(source || '')
    .split(/\r?\n/)
    .filter((line) => !isCommonHtmlBoilerplateLine(line))
    .join('\n');
}

function hasCommonHtmlBoilerplateOverlap(documentA, documentB) {
  if (!isHtmlLikeFile(documentA) || !isHtmlLikeFile(documentB)) return false;
  const first = new Set(getCommonHtmlBoilerplateLines(documentA.rawText || documentA.normalizedText));
  if (!first.size) return false;
  return getCommonHtmlBoilerplateLines(documentB.rawText || documentB.normalizedText).some((line) => first.has(line));
}

export function isCommonHtmlBoilerplateSnippet(source, file = {}) {
  if (!isHtmlLikeFile(file)) return false;

  const lines = String(source || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 0 && lines.every((line) => isCommonHtmlBoilerplateLine(line));
}

function getCommonHtmlBoilerplateLines(source) {
  return String(source || '')
    .split(/\r?\n/)
    .map((line) => normalizeHtmlBoilerplateLine(line))
    .filter((line) => line && isCommonHtmlBoilerplateLine(line));
}

function isHtmlLikeFile(file = {}) {
  const language = String(file.language || '').toLowerCase();
  const filePath = String(file.filePath || '').toLowerCase();
  return language.includes('html') || filePath.endsWith('.html') || filePath.endsWith('.htm');
}

function isCommonHtmlBoilerplateLine(line) {
  const normalized = normalizeHtmlBoilerplateLine(line);
  if (!normalized) return false;
  if (htmlBoilerplateLinePatterns.some((pattern) => pattern.test(normalized))) return true;
  if (htmlBoilerplateTitlePattern.test(normalized)) return true;
  if (htmlBoilerplateLinkPattern.test(normalized)) return true;
  if (htmlBoilerplateScriptPattern.test(normalized)) return true;
  return false;
}

function normalizeHtmlBoilerplateLine(line) {
  return String(line || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*=\s*/g, '=')
    .replace(/\s*\/>$/g, '>')
    .toLowerCase();
}

function calculateNearDuplicateScore({ tokenScore, fingerprintScore, structureScore, stringScore }) {
  const strongTokenOverlap = tokenScore >= 0.9;
  const strongTextOverlap = stringScore >= 0.88;
  const strongWindowOverlap = fingerprintScore >= 0.72;

  if (!strongTokenOverlap || (!strongTextOverlap && !strongWindowOverlap)) return 0;

  const weightedScore =
    tokenScore * 0.42 +
    fingerprintScore * 0.28 +
    structureScore * 0.15 +
    stringScore * 0.15;

  return Math.min(0.99, Math.max(weightedScore, tokenScore, stringScore));
}

function calculateShortFileBoostScore({ documentA, documentB, tokenScore, rawTokenScore, stringScore }) {
  const lineCount = Math.max(
    normalizeComparableLines(documentA.rawText || documentA.normalizedText).length,
    normalizeComparableLines(documentB.rawText || documentB.normalizedText).length,
  );

  if (!lineCount || lineCount > 20) return 0;
  if (tokenScore >= 0.9) return Math.min(0.99, Math.max(tokenScore, rawTokenScore * 0.98, stringScore));
  if (tokenScore >= 0.82 && rawTokenScore >= 0.82) return Math.min(0.92, Math.max(tokenScore, rawTokenScore) * 0.96);
  return 0;
}

function normalizedStringSimilarity(textA, textB) {
  const a = textA.slice(0, 5000);
  const b = textB.slice(0, 5000);
  if (!a.length || !b.length) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function findMatchedSections(documentA, documentB, finalScore, metrics = {}) {
  const sourceLines = normalizeLines(documentA.rawText, documentA);
  const comparedLines = normalizeLines(documentB.rawText, documentB);
  const exactFullFile =
    metrics.exactFullContentScore >= 0.98 ||
    metrics.exactLineScore >= 0.98 ||
    (finalScore >= 0.995 && metrics.exactScore >= 0.98);

  if (exactFullFile) {
    const fullMatch = makeFullFileBlockMatch(documentA, documentB, sourceLines, comparedLines, finalScore);
    if (fullMatch) return [fullMatch];
  }

  const matches = [];

  for (let sourceIndex = 0; sourceIndex < sourceLines.length; sourceIndex += 1) {
    const sourceLine = sourceLines[sourceIndex];
    if (sourceLine.isBoilerplate) continue;
    if (!sourceLine.normalized || sourceLine.normalized.length < 12) continue;

    const comparedIndex = comparedLines.findIndex(
      (line) => !line.isBoilerplate && line.normalized === sourceLine.normalized && line.normalized.length >= 12,
    );

    if (comparedIndex === -1) continue;

    matches.push({
      sourceFileId: documentA.id,
      comparedFileId: documentB.id,
      sourceFile: documentA.filePath,
      comparedFile: documentB.filePath,
      sourceLines: `${sourceLine.lineNumber}-${sourceLine.lineNumber}`,
      comparedLines: `${comparedLines[comparedIndex].lineNumber}-${comparedLines[comparedIndex].lineNumber}`,
      sourceSnippet: sourceLine.original,
      comparedSnippet: comparedLines[comparedIndex].original,
      confidence: Math.round(finalScore * 100),
      matchType: finalScore >= 0.82 ? 'copied_code' : 'similar_logic',
    });

    if (matches.length >= 3) break;
  }

  if (!matches.length && finalScore >= 0.55) {
    const candidateMatches = findClosestLineMatches(sourceLines, comparedLines, finalScore, documentA, documentB);
    matches.push(...candidateMatches);
  }

  if (!matches.length && finalScore >= 0.82) {
    const blockMatch = makeRepresentativeBlockMatch(documentA, documentB, sourceLines, comparedLines, finalScore);
    if (blockMatch) matches.push(blockMatch);
  }

  return matches;
}

function normalizeLines(source, document = {}) {
  return source.split(/\r?\n/).map((line, index) => {
    const normalizedTokens = normalizeTokens(tokenize(stripComments(line)));
    return {
      lineNumber: index + 1,
      original: line,
      normalizedTokens,
      normalized: normalizedTokens.join(' '),
      isBoilerplate: isHtmlLikeFile(document) && isCommonHtmlBoilerplateLine(line),
    };
  });
}

function findClosestLineMatches(sourceLines, comparedLines, finalScore, documentA, documentB) {
  const sourceCandidates = sourceLines
    .filter((line) => !line.isBoilerplate && line.normalized.length >= 12 && line.normalizedTokens.length >= 3)
    .slice(0, 220);
  const comparedCandidates = comparedLines
    .filter((line) => !line.isBoilerplate && line.normalized.length >= 12 && line.normalizedTokens.length >= 3)
    .slice(0, 220);
  const candidates = [];

  for (const sourceLine of sourceCandidates) {
    for (const comparedLine of comparedCandidates) {
      const tokenScore = cosineSimilarity(sourceLine.normalizedTokens, comparedLine.normalizedTokens);
      const stringScore = normalizedStringSimilarity(sourceLine.normalized, comparedLine.normalized);
      const lineScore = tokenScore * 0.7 + stringScore * 0.3;

      if (lineScore < 0.58) continue;

      candidates.push({
        sourceLine,
        comparedLine,
        score: Math.min(1, Math.max(finalScore, lineScore)),
      });
    }
  }

  const usedSourceLines = new Set();
  const usedComparedLines = new Set();
  const matches = [];

  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (usedSourceLines.has(candidate.sourceLine.lineNumber)) continue;
    if (usedComparedLines.has(candidate.comparedLine.lineNumber)) continue;

    usedSourceLines.add(candidate.sourceLine.lineNumber);
    usedComparedLines.add(candidate.comparedLine.lineNumber);
    matches.push({
      sourceFileId: documentA.id,
      comparedFileId: documentB.id,
      sourceFile: documentA.filePath,
      comparedFile: documentB.filePath,
      sourceLines: `${candidate.sourceLine.lineNumber}-${candidate.sourceLine.lineNumber}`,
      comparedLines: `${candidate.comparedLine.lineNumber}-${candidate.comparedLine.lineNumber}`,
      sourceSnippet: candidate.sourceLine.original,
      comparedSnippet: candidate.comparedLine.original,
      confidence: Math.round(candidate.score * 100),
      matchType: finalScore >= 0.82 ? 'copied_code' : 'similar_logic',
    });

    if (matches.length >= 3) break;
  }

  return matches;
}

function makeFullFileBlockMatch(documentA, documentB, sourceLines, comparedLines, finalScore) {
  const sourceBlock = fullCodeBlock(sourceLines);
  const comparedBlock = fullCodeBlock(comparedLines);

  if (!sourceBlock || !comparedBlock) return null;

  return {
    sourceFileId: documentA.id,
    comparedFileId: documentB.id,
    sourceFile: documentA.filePath,
    comparedFile: documentB.filePath,
    sourceLines: `${sourceBlock.startLine}-${sourceBlock.endLine}`,
    comparedLines: `${comparedBlock.startLine}-${comparedBlock.endLine}`,
    sourceSnippet: sourceBlock.snippet,
    comparedSnippet: comparedBlock.snippet,
    confidence: Math.round(finalScore * 100),
    matchType: 'copied_full_file',
  };
}

function fullCodeBlock(lines) {
  const firstIndex = lines.findIndex((line) => !line.isBoilerplate && line.original.trim().length > 0);
  const lastIndex = lines.findLastIndex((line) => !line.isBoilerplate && line.original.trim().length > 0);

  if (firstIndex < 0 || lastIndex < firstIndex) return null;

  const blockLines = lines.slice(firstIndex, lastIndex + 1).filter((line) => !line.isBoilerplate);
  const snippet = blockLines.map((line) => line.original).join('\n').trimEnd();
  if (!snippet.trim()) return null;

  return {
    startLine: blockLines[0].lineNumber,
    endLine: blockLines[blockLines.length - 1].lineNumber,
    snippet,
  };
}

function makeRepresentativeBlockMatch(documentA, documentB, sourceLines, comparedLines, finalScore) {
  const sourceBlock = firstCodeBlock(sourceLines);
  const comparedBlock = firstCodeBlock(comparedLines);

  if (!sourceBlock || !comparedBlock) return null;

  return {
    sourceFileId: documentA.id,
    comparedFileId: documentB.id,
    sourceFile: documentA.filePath,
    comparedFile: documentB.filePath,
    sourceLines: `${sourceBlock.startLine}-${sourceBlock.endLine}`,
    comparedLines: `${comparedBlock.startLine}-${comparedBlock.endLine}`,
    sourceSnippet: sourceBlock.snippet,
    comparedSnippet: comparedBlock.snippet,
    confidence: Math.round(finalScore * 100),
    matchType: finalScore >= 0.82 ? 'copied_code' : 'similar_logic',
  };
}

function firstCodeBlock(lines) {
  const preferredIndex = lines.findIndex((line) => !line.isBoilerplate && line.normalizedTokens.length > 0);
  const fallbackIndex = lines.findIndex((line) => !line.isBoilerplate && line.original.trim().length > 0);
  const startIndex = preferredIndex >= 0 ? preferredIndex : fallbackIndex;

  if (startIndex < 0) return null;

  const blockLines = [];
  let endIndex = startIndex;

  for (let index = startIndex; index < lines.length && blockLines.length < 12; index += 1) {
    const line = lines[index];
    if (!line.original.trim() && blockLines.length === 0) continue;
    blockLines.push(line.original);
    endIndex = index;
  }

  const snippet = blockLines.join('\n').trimEnd();
  if (!snippet.trim()) return null;

  return {
    startLine: lines[startIndex].lineNumber,
    endLine: lines[endIndex].lineNumber,
    snippet,
  };
}

function findRenamedVariables(documentA, documentB, metrics) {
  if (metrics.renamedVariableScore < 0.08 || metrics.tokenScore < 0.55) return [];

  const hints = [];
  const aIdentifiers = documentA.identifiers.slice(0, 80);
  const bIdentifiers = documentB.identifiers.slice(0, 80);
  const length = Math.min(aIdentifiers.length, bIdentifiers.length);

  for (let index = 0; index < length; index += 1) {
    const from = aIdentifiers[index];
    const to = bIdentifiers[index];
    if (from === to || reserved.has(from) || reserved.has(to)) continue;

    hints.push({
      from,
      to,
      confidence: Math.round(Math.min(0.97, metrics.tokenScore + metrics.renamedVariableScore) * 100),
    });
  }

  return hints;
}

function dedupeRenameHints(hints) {
  const seen = new Map();
  for (const hint of hints) {
    const key = `${hint.from}->${hint.to}`;
    if (!seen.has(key) || seen.get(key).confidence < hint.confidence) {
      seen.set(key, hint);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
}

function calculateProjectScore(sortedPairs) {
  if (!sortedPairs.length) return 0;
  const topFive = sortedPairs.slice(0, 5);
  const strongestScore = Number(sortedPairs[0]?.score || 0);
  const average = topFive.reduce((total, pair) => total + pair.score, 0) / topFive.length;
  const repeatBonus = Math.min(8, Math.max(0, sortedPairs.length - 1) * 1.5);
  return Math.min(100, Math.round(Math.max(strongestScore, average + repeatBonus)));
}

function toPercentMetrics(metrics, semanticScore) {
  return {
    exact: Math.round(metrics.exactScore * 100),
    tokens: Math.round(metrics.tokenScore * 100),
    structure: Math.round(metrics.structureScore * 100),
    fingerprint: Math.round(metrics.fingerprintScore * 100),
    renamedVariables: Math.round(metrics.renamedVariableScore * 100),
    semantic: typeof semanticScore === 'number' ? Math.round(semanticScore * 100) : null,
  };
}

function classifyMatch(metrics, semanticScore) {
  if (metrics.exactFullContentScore >= 0.98 || metrics.exactLineScore >= 0.98) return 'Exact full-file match';
  if (metrics.exactScore >= 0.98) return 'Exact copied code';
  if (metrics.nearDuplicateScore >= 0.92) return 'Near-identical copied code';
  if (metrics.shortFileBoostScore >= 0.9) return 'Short-file high token match';
  if (metrics.renamedVariableScore >= 0.18 && metrics.tokenScore >= 0.7) {
    return 'Renamed variables, same logic';
  }
  if (metrics.structureScore >= 0.75) return 'Similar function structure';
  if (typeof semanticScore === 'number' && semanticScore >= 0.72) return 'Semantic logic similarity';
  return 'Partial token and structure similarity';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
