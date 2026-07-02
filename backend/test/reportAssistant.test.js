import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_ASSISTANT_DISCLAIMER,
  answerReportQuestion,
  buildReportAssistantContext,
} from '../src/services/reportAssistant.js';
import { config } from '../src/config.js';

const sampleReport = {
  id: 'report-ai-assistant-test',
  projectTitle: 'Submission A vs Submission B',
  comparedWith: 'Submission B',
  similarityScore: 72,
  exactMatchScore: 64,
  structuralSimilarityScore: 81,
  semanticSimilarityScore: 78,
  variableRenameScore: 45,
  variableRenameDetection: {
    detected: true,
    score: 45,
  },
  summary: 'Moderate to high similarity was detected across authentication helpers.',
  submissionCompared: {
    source: {
      id: 'a',
      title: 'Submission A',
      studentName: 'James Matthew Dela Torre',
    },
    compared: {
      id: 'b',
      title: 'Submission B',
      studentName: 'Previous Student',
    },
  },
  filePairs: [
    {
      source: 'src/AuthController.php',
      compared: 'archive/LoginController.php',
      score: 91,
      matchType: 'Similar function structure',
      explanation: 'Control flow and password verification structure are closely aligned.',
      metrics: {
        exact: 64,
        structure: 88,
        semantic: 82,
        renamedVariables: 45,
      },
    },
  ],
  matchedSections: [
    {
      sourceFile: 'src/AuthController.php',
      sourceLines: '14-38',
      comparedFile: 'archive/LoginController.php',
      comparedLines: '12-36',
      confidence: 94,
      matchType: 'similar_logic',
      sourceSnippet: 'if ($user && password_verify($password, $user->password)) { return redirect("/dashboard"); }',
      comparedSnippet: 'if ($account && password_verify($pass, $account->password)) { return redirect("/home"); }',
    },
  ],
  renamedVariables: [
    {
      from: '$user',
      to: '$account',
      confidence: 91,
    },
  ],
  authorFingerprint: {
    available: true,
    authorConsistencyScore: 82,
    styleDeviation: 'Low Style Deviation',
    aiAnalysis: 'The submitted project closely matches the student history.',
    recommendation: 'Use as supporting context only.',
    signals: [
      {
        name: 'Variable naming',
        score: 88,
        sourceStyle: 'camelCase',
        historyStyle: 'camelCase',
      },
    ],
  },
};

test('builds report assistant context from the selected report only', () => {
  const context = buildReportAssistantContext(sampleReport);

  assert.equal(context.submissionA.title, 'Submission A');
  assert.equal(context.submissionB.title, 'Submission B');
  assert.equal(context.scores.overallSimilarity, 72);
  assert.equal(context.suspiciousFilePairs[0].source, 'src/AuthController.php');
  assert.equal(context.highlightedCodeSections[0].confidence, 94);
  assert.equal(context.renamedVariables[0].to, '$account');
  assert.equal(context.authorFingerprint.authorConsistencyScore, 82);
});

test('refuses unrelated questions instead of answering outside the report', async () => {
  const response = await answerReportQuestion({
    report: sampleReport,
    message: 'What is the weather today?',
  });

  assert.equal(response.usedAi, false);
  assert.equal(response.provider, 'report-scope-guard');
  assert.match(response.answer, /currently opened plagiarism report/i);
  assert.match(response.answer, new RegExp(REPORT_ASSISTANT_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('returns an advisory report-grounded answer when AI runtime is unavailable in tests', async () => {
  const response = await answerReportQuestion({
    report: sampleReport,
    action: 'summarize',
  });

  assert.equal(response.usedAi, false);
  assert.match(response.answer, /overall similarity score is 72%/i);
  assert.match(response.answer, /suspicious file pair/i);
  assert.match(response.answer, new RegExp(REPORT_ASSISTANT_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('sends report context to messages-based chat APIs', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = config.aiChatApiUrl;
  const originalFormat = config.aiChatApiFormat;
  let capturedBody;

  config.aiChatApiUrl = 'https://example.test/chat';
  config.aiChatApiFormat = 'messages';
  globalThis.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          response: 'The 72% score is mainly supported by structural and semantic similarity in the authentication files.',
          messages: [
            ...capturedBody.messages,
            {
              role: 'assistant',
              content:
                'The 72% score is mainly supported by structural and semantic similarity in the authentication files.',
            },
          ],
        };
      },
    };
  };

  try {
    const response = await answerReportQuestion({
      report: sampleReport,
      message: 'Explain the similarity score.',
      history: [{ role: 'user', content: 'Summarize this first.' }],
    });

    assert.equal(response.usedAi, true);
    assert.equal(capturedBody.messages[0].role, 'system');
    assert.equal(capturedBody.messages.at(-1).role, 'user');
    assert.match(capturedBody.messages.at(-1).content, /CURRENT_REPORT_CONTEXT/);
    assert.match(capturedBody.messages.at(-1).content, /AuthController/);
    assert.match(response.answer, /72% score/);
    assert.match(response.answer, new RegExp(REPORT_ASSISTANT_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    config.aiChatApiUrl = originalUrl;
    config.aiChatApiFormat = originalFormat;
    globalThis.fetch = originalFetch;
  }
});
