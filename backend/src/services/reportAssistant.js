import { config } from '../config.js';

export const REPORT_ASSISTANT_DISCLAIMER =
  'This analysis is intended to assist instructors. Final plagiarism decisions should always be based on manual review and academic policies.';

const assistantActionPrompts = {
  summarize:
    'Summarize this plagiarism report for an instructor. Focus on the strongest evidence, major scores, and what should be reviewed manually.',
  explain_score:
    'Explain why this report received its overall similarity score. Use exact, structural, semantic, renamed variable, file-pair, and highlighted-section evidence from the report.',
  explain_highlights:
    'Explain the highlighted code sections in plain language. Identify which sections should be reviewed first and why.',
  instructor_notes:
    'Generate professional instructor notes for this report. Include key evidence, manual review recommendations, and avoid making a final plagiarism decision.',
  pdf_summary:
    'Generate a concise PDF-ready summary for an instructor. Include report overview, strongest evidence, author fingerprint notes if available, and manual review guidance.',
};

let localGeneratorPromise;
const assistantRuntime = {
  enabled: Boolean(config.aiChatApiUrl) || config.enableReportAssistantLocalAi,
  provider: config.aiChatApiUrl
    ? config.aiChatApiFormat === 'openai'
      ? 'openai-compatible-chat'
      : 'messages-chat-api'
    : '@huggingface/transformers',
  model: config.aiChatApiUrl
    ? config.aiChatApiFormat === 'openai'
      ? config.aiChatModel
      : config.aiChatApiUrl
    : config.reportAssistantModel,
  status: 'ready',
  fallback: 'report-grounded-extractive-assistant',
};

export function getReportAssistantRuntimeInfo() {
  return { ...assistantRuntime };
}

export async function answerReportQuestion({ report, message, action, history }) {
  const prompt = normalizeAssistantPrompt({ message, action });
  if (!report || report.waiting) {
    const error = new Error('AI Report Assistant is available only for completed plagiarism reports.');
    error.status = 400;
    throw error;
  }

  const context = buildReportAssistantContext(report);
  const conversationHistory = normalizeConversationHistory(history);

  if (isClearlyUnrelated(prompt)) {
    return {
      answer: withDisclaimer(
        'I can only answer questions about the currently opened plagiarism report. Please ask about the similarity score, matched files, highlighted code, renamed variables, semantic analysis, or author fingerprint evidence in this report.',
      ),
      provider: 'report-scope-guard',
      model: 'scope-check',
      reportId: report.id,
      usedAi: false,
    };
  }

  try {
    const answer =
      config.aiChatApiUrl
        ? await withTimeout(answerWithChatApi({ prompt, context, history: conversationHistory }), 25000, 'AI chat API timed out.')
        : await withTimeout(
            answerWithLocalModel({ prompt, context, history: conversationHistory }),
            12000,
            'Local report assistant AI timed out.',
          );

    return {
      answer: withDisclaimer(cleanAssistantAnswer(answer)),
      provider: assistantRuntime.provider,
      model: assistantRuntime.model,
      reportId: report.id,
      usedAi: true,
    };
  } catch (error) {
    assistantRuntime.status = 'fallback_report_reasoner';
    assistantRuntime.lastError = error.message;

    return {
      answer: withDisclaimer(buildExtractiveFallbackAnswer(prompt, context)),
      provider: assistantRuntime.fallback,
      model: 'report-context-rules',
      reportId: report.id,
      usedAi: false,
    };
  }
}

export function buildReportAssistantContext(report) {
  const compared = report.submissionCompared || {};
  const source = compared.source || report.submission || {};
  const target = compared.compared || {};
  const filePairs = (report.filePairs || []).slice(0, 12).map((pair) => ({
    source: pair.source,
    compared: pair.compared,
    score: Number(pair.score || 0),
    matchType: pair.matchType || 'Similarity evidence',
    explanation: pair.explanation || '',
    exact: pair.metrics?.exact ?? null,
    structure: pair.metrics?.structure ?? null,
    semantic: pair.metrics?.semantic ?? null,
    renamedVariables: pair.metrics?.renamedVariables ?? null,
  }));
  const highlightedSections = (report.matchedSections || []).slice(0, 8).map((section) => ({
    sourceFile: section.sourceFile,
    sourceLines: section.sourceLines,
    comparedFile: section.comparedFile,
    comparedLines: section.comparedLines,
    confidence: section.confidence,
    matchType: section.matchType,
    sourceSnippet: clipText(section.sourceSnippet, 700),
    comparedSnippet: clipText(section.comparedSnippet, 700),
  }));
  const renamedVariables = (report.renamedVariables || []).slice(0, 12).map((item) => ({
    from: item.from,
    to: item.to,
    confidence: item.confidence,
  }));
  const authorFingerprint = report.authorFingerprint
    ? {
        available: Boolean(report.authorFingerprint.available),
        authorConsistencyScore: report.authorFingerprint.authorConsistencyScore,
        styleDeviation: report.authorFingerprint.styleDeviation,
        aiAnalysis: report.authorFingerprint.aiAnalysis,
        recommendation: report.authorFingerprint.recommendation,
        signals: (report.authorFingerprint.signals || []).slice(0, 8).map((signal) => ({
          name: signal.name,
          score: signal.score,
          sourceStyle: signal.sourceStyle,
          historyStyle: signal.historyStyle,
        })),
      }
    : null;

  return {
    reportId: report.id,
    projectTitle: report.projectTitle,
    comparedWith: report.comparedWith,
    generatedAt: report.generatedAt,
    submissionA: {
      id: source.id,
      title: source.title || report.projectTitle || 'Submission A',
      studentName: source.studentName,
      subject: source.subject,
      section: source.section,
    },
    submissionB: {
      id: target.id,
      title: target.title || report.comparedWith || 'Submission B',
      studentName: target.studentName,
    },
    scores: {
      overallSimilarity: Number(report.similarityScore || 0),
      exactMatch: Number(report.exactMatchScore || chartValue(report.chartData, 'Exact') || 0),
      structuralSimilarity: Number(report.structuralSimilarityScore || chartValue(report.chartData, 'Structure') || 0),
      semanticSimilarity: Number(report.semanticSimilarityScore || chartValue(report.chartData, 'Semantic') || 0),
      variableRename: Number(report.variableRenameScore || chartValue(report.chartData, 'Renamed') || 0),
    },
    variableRenameDetection: report.variableRenameDetection || {
      detected: renamedVariables.length > 0,
      score: Number(report.variableRenameScore || 0),
    },
    summary: report.summary || '',
    aiSimilarityAnalysis: report.aiIntegration || null,
    suspiciousFilePairs: filePairs,
    highlightedCodeSections: highlightedSections,
    renamedVariables,
    authorFingerprint,
  };
}

async function answerWithChatApi({ prompt, context, history }) {
  if (config.aiChatApiFormat === 'openai') {
    return answerWithOpenAiChatApi({ prompt, context, history });
  }
  return answerWithMessagesChatApi({ prompt, context, history });
}

async function answerWithOpenAiChatApi({ prompt, context, history }) {
  assistantRuntime.status = 'calling_chat_api';
  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.aiChatApiKey) headers.Authorization = `Bearer ${config.aiChatApiKey}`;

  const response = await fetch(config.aiChatApiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.aiChatModel,
      temperature: 0.2,
      max_tokens: 650,
      messages: [
        {
          role: 'system',
          content: buildSystemInstruction(),
        },
        ...history,
        {
          role: 'user',
          content: buildGroundedPrompt(prompt, context),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI chat API failed with status ${response.status}: ${clipText(body, 220)}`);
  }

  const data = await response.json();
  assistantRuntime.status = 'chat_api_response';
  return data.choices?.[0]?.message?.content || '';
}

async function answerWithMessagesChatApi({ prompt, context, history }) {
  assistantRuntime.status = 'calling_messages_chat_api';
  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.aiChatApiKey) headers.Authorization = `Bearer ${config.aiChatApiKey}`;

  const messages = [
    {
      role: 'system',
      content: buildSystemInstruction(),
    },
    ...history,
    {
      role: 'user',
      content: buildGroundedPrompt(prompt, context),
    },
  ];

  const response = await fetch(config.aiChatApiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Messages chat API failed with status ${response.status}: ${clipText(body, 220)}`);
  }

  const data = await response.json();
  assistantRuntime.status = 'messages_chat_api_response';
  return extractMessagesApiResponse(data);
}

async function answerWithLocalModel({ prompt, context, history }) {
  if (!config.enableReportAssistantLocalAi) {
    throw new Error('Local report assistant AI is disabled.');
  }

  assistantRuntime.status = 'loading_local_report_assistant';
  const generator = await getLocalGenerator();
  assistantRuntime.status = 'local_report_assistant';
  const output = await generator(buildLocalPrompt(prompt, context, history), {
    max_new_tokens: 260,
    temperature: 0.2,
  });
  const result = Array.isArray(output) ? output[0] : output;
  return result?.generated_text || result?.summary_text || result?.text || '';
}

async function getLocalGenerator() {
  if (!localGeneratorPromise) {
    localGeneratorPromise = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline(config.reportAssistantTask, config.reportAssistantModel),
    );
  }
  return localGeneratorPromise;
}

function normalizeAssistantPrompt({ message, action }) {
  const actionPrompt = assistantActionPrompts[action];
  const cleanMessage = String(message || '').trim().replace(/\s+/g, ' ').slice(0, 1200);
  return actionPrompt || cleanMessage || assistantActionPrompts.summarize;
}

function normalizeConversationHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => ['user', 'assistant'].includes(message?.role) && message?.content)
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: String(message.content).replace(/\s+/g, ' ').slice(0, 900),
    }));
}

function buildSystemInstruction() {
  return [
    'You are the AI Report Assistant for CodeGuard AI.',
    'Answer only using the CURRENT_REPORT_CONTEXT provided by the server.',
    'Do not use outside facts, assumptions, web knowledge, or information from other reports.',
    'If the question is unrelated to the current report, say you can only answer questions about this report.',
    'Never make the final plagiarism decision and never accuse a student.',
    'Use clear, professional language for instructors.',
    `End every answer with this exact disclaimer: "${REPORT_ASSISTANT_DISCLAIMER}"`,
  ].join(' ');
}

function buildGroundedPrompt(prompt, context) {
  return `CURRENT_REPORT_CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nINSTRUCTOR_QUESTION:\n${prompt}\n\nAnswer using only CURRENT_REPORT_CONTEXT.`;
}

function buildLocalPrompt(prompt, context, history = []) {
  return [
    buildSystemInstruction(),
    '',
    'Report facts:',
    renderContextAsText(context),
    '',
    'Recent chat:',
    history.map((message) => `${message.role}: ${message.content}`).join('\n') || 'No previous chat turns.',
    '',
    `Question: ${prompt}`,
    '',
    'Professional report-grounded answer:',
  ].join('\n');
}

function renderContextAsText(context) {
  const lines = [
    `Submission A: ${context.submissionA.title}`,
    `Submission B: ${context.submissionB.title}`,
    `Overall Similarity Score: ${context.scores.overallSimilarity}%`,
    `Exact Match Score: ${context.scores.exactMatch}%`,
    `Structural Similarity: ${context.scores.structuralSimilarity}%`,
    `Semantic Similarity: ${context.scores.semanticSimilarity}%`,
    `Variable Rename Detection: ${context.variableRenameDetection.detected ? 'Detected' : 'Not strongly detected'} (${context.scores.variableRename}%)`,
    `Report Summary: ${context.summary}`,
  ];

  if (context.suspiciousFilePairs.length) {
    lines.push('Suspicious File Pairs:');
    context.suspiciousFilePairs.slice(0, 6).forEach((pair) => {
      lines.push(`- ${pair.source} vs ${pair.compared}: ${pair.score}% (${pair.matchType}). ${pair.explanation}`);
    });
  }

  if (context.highlightedCodeSections.length) {
    lines.push('Highlighted Code Sections:');
    context.highlightedCodeSections.slice(0, 4).forEach((section) => {
      lines.push(
        `- ${section.sourceFile} lines ${section.sourceLines} vs ${section.comparedFile} lines ${section.comparedLines}: ${section.confidence}% ${section.matchType}.`,
      );
    });
  }

  if (context.renamedVariables.length) {
    lines.push(
      `Renamed Variables: ${context.renamedVariables
        .slice(0, 8)
        .map((item) => `${item.from} -> ${item.to} (${item.confidence}%)`)
        .join(', ')}`,
    );
  }

  if (context.authorFingerprint) {
    lines.push(
      `Author Fingerprint: ${context.authorFingerprint.authorConsistencyScore ?? 'insufficient'}% consistency, ${context.authorFingerprint.styleDeviation}. ${context.authorFingerprint.aiAnalysis || ''}`,
    );
  }

  return clipText(lines.join('\n'), 9000);
}

function buildExtractiveFallbackAnswer(prompt, context) {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('highlight')) {
    if (!context.highlightedCodeSections.length) {
      return 'This report does not include line-level highlighted code sections. Review the suspicious file pairs and similarity signal scores first.';
    }
    const sections = context.highlightedCodeSections
      .slice(0, 3)
      .map(
        (section) =>
          `${section.sourceFile} lines ${section.sourceLines} should be compared with ${section.comparedFile} lines ${section.comparedLines} because the section confidence is ${section.confidence}%.`,
      )
      .join(' ');
    return `The first highlighted sections to review are: ${sections}`;
  }

  if (lowerPrompt.includes('variable') || lowerPrompt.includes('renamed')) {
    if (!context.renamedVariables.length) return 'This report does not show strong variable rename indicators.';
    return `The report lists these rename indicators: ${context.renamedVariables
      .map((item) => `${item.from} -> ${item.to} (${item.confidence}%)`)
      .join(', ')}.`;
  }

  if (lowerPrompt.includes('score') || lowerPrompt.includes('why')) {
    const strongestPair = context.suspiciousFilePairs[0];
    return `The overall similarity score is ${context.scores.overallSimilarity}%. Supporting signals include exact match ${context.scores.exactMatch}%, structural similarity ${context.scores.structuralSimilarity}%, semantic similarity ${context.scores.semanticSimilarity}%, and variable rename evidence ${context.scores.variableRename}%. ${
      strongestPair
        ? `The strongest suspicious file pair is ${strongestPair.source} vs ${strongestPair.compared} at ${strongestPair.score}%.`
        : 'No suspicious file pairs were retained in the report.'
    }`;
  }

  if (lowerPrompt.includes('note')) {
    return `Instructor notes: ${context.summary} Review the highest scoring file pairs, highlighted code sections, and rename indicators before making any academic decision.`;
  }

  return `Report summary: ${context.submissionA.title} was compared with ${context.submissionB.title}. The overall similarity score is ${context.scores.overallSimilarity}%. The report includes ${context.suspiciousFilePairs.length} suspicious file pair(s), ${context.highlightedCodeSections.length} highlighted code section(s), and ${context.renamedVariables.length} variable rename indicator(s).`;
}

function isClearlyUnrelated(prompt) {
  const text = prompt.toLowerCase();
  const reportTerms = [
    'report',
    'similar',
    'score',
    'file',
    'code',
    'section',
    'highlight',
    'variable',
    'rename',
    'semantic',
    'exact',
    'structure',
    'copied',
    'implementation',
    'evidence',
    'summary',
    'instructor',
    'manual review',
    'fingerprint',
    'plagiarism',
  ];
  const unrelatedTerms = [
    'weather',
    'sports',
    'recipe',
    'movie',
    'president',
    'stock',
    'crypto',
    'write a poem',
    'joke',
    'translate',
    'relationship',
  ];

  return unrelatedTerms.some((term) => text.includes(term)) && !reportTerms.some((term) => text.includes(term));
}

function cleanAssistantAnswer(answer) {
  const cleaned = String(answer || '')
    .replace(/^professional report-grounded answer:\s*/i, '')
    .trim();

  if (!cleaned) throw new Error('AI assistant returned an empty answer.');
  return clipText(cleaned, 4000);
}

function extractMessagesApiResponse(data = {}) {
  if (typeof data.response === 'string' && data.response.trim()) return data.response;
  if (typeof data.answer === 'string' && data.answer.trim()) return data.answer;
  if (typeof data.output === 'string' && data.output.trim()) return data.output;

  const messages = Array.isArray(data.messages) ? data.messages : [];
  const assistantMessage = [...messages]
    .reverse()
    .find((message) => message?.role === 'assistant' && typeof message.content === 'string' && message.content.trim());

  return assistantMessage?.content || '';
}

function withDisclaimer(answer) {
  const cleanAnswer = String(answer || '').trim();
  if (cleanAnswer.includes(REPORT_ASSISTANT_DISCLAIMER)) return cleanAnswer;
  return `${cleanAnswer}\n\n${REPORT_ASSISTANT_DISCLAIMER}`;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function chartValue(chartData = [], name) {
  return chartData.find((item) => item.name === name)?.value;
}

function clipText(value, maxLength) {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}
