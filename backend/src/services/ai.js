import { config } from '../config.js';

let extractorPromise;
const runtime = {
  enabled: config.enableLocalAi,
  provider: '@huggingface/transformers',
  model: config.localAiModel,
  status: config.enableLocalAi ? 'ready_to_load' : 'disabled',
  fallback: 'semantic-feature-vector',
};

export async function semanticSimilarity(documentA, documentB) {
  if (!config.enableLocalAi) {
    runtime.status = 'disabled';
    return null;
  }

  try {
    const extractor = await getExtractor();
    const [embeddingA, embeddingB] = await Promise.all([
      embedText(extractor, documentA.normalizedText),
      embedText(extractor, documentB.normalizedText),
    ]);
    runtime.status = 'transformer_embeddings';
    return cosineArrays(embeddingA, embeddingB);
  } catch (error) {
    runtime.status = 'fallback_semantic_features';
    runtime.lastError = error.message;
    return semanticFeatureSimilarity(documentA, documentB);
  }
}

export function getAiRuntimeInfo() {
  return { ...runtime };
}

export function explainSimilarity(metrics, semanticScore) {
  const reasons = [];

  if (metrics.exactScore >= 0.98) {
    reasons.push('files are nearly identical at the hash or normalized text level');
  }

  if (metrics.fingerprintScore >= 0.72) {
    reasons.push('large token windows appear in both files');
  }

  if (metrics.structureScore >= 0.7) {
    reasons.push('control flow and function structure are closely aligned');
  }

  if (metrics.renamedVariableScore >= 0.65) {
    reasons.push('identifier-normalized comparison is much stronger than raw-token comparison');
  }

  if (typeof semanticScore === 'number' && semanticScore >= 0.7) {
    reasons.push('the local semantic model places the files close together');
  }

  if (reasons.length === 0) {
    reasons.push('similarity is below the configured suspicious threshold');
  }

  return `The comparison indicates that ${reasons.join(', ')}.`;
}

async function getExtractor() {
  if (!extractorPromise) {
    runtime.status = 'loading_transformer_model';
    extractorPromise = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', config.localAiModel),
    );
  }
  return extractorPromise;
}

async function embedText(extractor, text) {
  const clipped = text.slice(0, 8000);
  const output = await extractor(clipped, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

function cosineArrays(vectorA, vectorB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(vectorA.length, vectorB.length);

  for (let index = 0; index < length; index += 1) {
    dot += vectorA[index] * vectorB[index];
    normA += vectorA[index] ** 2;
    normB += vectorB[index] ** 2;
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function semanticFeatureSimilarity(documentA, documentB) {
  return cosineArrays(buildSemanticFeatureVector(documentA), buildSemanticFeatureVector(documentB));
}

function buildSemanticFeatureVector(document) {
  const text = `${document.normalizedText} ${document.rawText || ''}`.toLowerCase();
  const tokens = document.normalizedTokens || [];

  const conceptGroups = [
    ['branching', ['if', 'else', 'switch', 'case', '?']],
    ['loops', ['for', 'while', 'foreach', 'do']],
    ['functions', ['function', 'def', 'return', '=>']],
    ['classes', ['class', 'interface', 'extends', 'implements', 'new']],
    ['errors', ['try', 'catch', 'finally', 'throw', 'throws']],
    ['async', ['async', 'await', 'promise', 'fetch']],
    ['data_access', ['select', 'insert', 'update', 'delete', 'query', 'database', 'sql', 'where']],
    ['authentication', ['login', 'password', 'session', 'token', 'auth', 'verify', 'user']],
    ['collections', ['list', 'array', 'map', 'set', 'push', 'length', 'count']],
    ['math', ['+', '-', '*', '/', '%', 'total', 'sum', 'average', 'compute']],
    ['ui', ['html', 'css', 'button', 'form', 'input', 'document', 'queryselector']],
    ['files', ['file', 'stream', 'read', 'write', 'upload', 'download']],
  ];

  const vector = conceptGroups.map(([, terms]) =>
    terms.reduce((score, term) => score + countOccurrences(text, term), 0),
  );

  vector.push(tokens.length / 200);
  vector.push((document.structure?.maxDepth || 0) / 10);
  vector.push((document.structure?.lineCount || 0) / 100);
  vector.push((document.identifiers?.length || 0) / 100);

  return vector;
}

function countOccurrences(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.match(new RegExp(`\\b${escaped}\\b`, 'g'));
  return matches?.length || 0;
}
