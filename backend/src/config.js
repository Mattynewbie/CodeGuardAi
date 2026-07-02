const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 40);
const maxTotalExtractedMb = Number(process.env.MAX_TOTAL_EXTRACTED_MB || 25);
const isTestRuntime =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.env.npm_lifecycle_event === 'test';
const defaultReportAssistantApiUrl = 'https://gpt-api-bay.vercel.app/chat';
const configuredAiChatApiUrl =
  process.env.AI_CHAT_API_URL ||
  process.env.REPORT_ASSISTANT_API_URL ||
  (process.env.OPENAI_API_KEY
    ? `${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`
    : null);
const aiChatApiUrl = isTestRuntime ? process.env.AI_CHAT_API_URL_TEST || null : configuredAiChatApiUrl || defaultReportAssistantApiUrl;
const aiChatApiFormat =
  process.env.AI_CHAT_API_FORMAT ||
  (aiChatApiUrl?.includes('/chat/completions') || process.env.OPENAI_API_KEY ? 'openai' : 'messages');

export const config = {
  port: Number(process.env.PORT || 4100),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),
  maxUploadBytes: maxUploadMb * 1024 * 1024,
  maxExtractedFiles: Number(process.env.MAX_EXTRACTED_FILES || 500),
  maxExtractedFileBytes: Number(process.env.MAX_EXTRACTED_FILE_BYTES || 1024 * 1024),
  maxTotalExtractedBytes: maxTotalExtractedMb * 1024 * 1024,
  enableLocalDemo: process.env.ENABLE_LOCAL_DEMO === 'true' || process.env.NODE_ENV !== 'production',
  enableLocalAi:
    isTestRuntime
      ? process.env.ENABLE_LOCAL_AI_TEST === 'true'
      : process.env.ENABLE_LOCAL_AI !== 'false',
  localAiModel: process.env.LOCAL_AI_MODEL || 'Xenova/all-MiniLM-L6-v2',
  aiChatApiUrl,
  aiChatApiKey: process.env.AI_CHAT_API_KEY || process.env.OPENAI_API_KEY,
  aiChatApiFormat,
  aiChatModel: process.env.AI_CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  enableReportAssistantLocalAi:
    isTestRuntime
      ? process.env.ENABLE_REPORT_ASSISTANT_AI_TEST === 'true'
      : process.env.ENABLE_REPORT_ASSISTANT_AI !== 'false',
  reportAssistantModel: process.env.REPORT_ASSISTANT_MODEL || 'Xenova/flan-t5-small',
  reportAssistantTask: process.env.REPORT_ASSISTANT_TASK || 'text2text-generation',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'project-uploads',
  allowedUploadExtensions: [
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
    '.hpp',
    '.html',
    '.css',
    '.sql',
    '.rb',
    '.go',
    '.rs',
    '.swift',
    '.kt',
    '.dart',
    '.vue',
    '.svelte',
  ],
};

export const supportedSourceExtensions = new Map([
  ['.php', 'PHP'],
  ['.js', 'JavaScript'],
  ['.jsx', 'React JSX'],
  ['.ts', 'TypeScript'],
  ['.tsx', 'React TSX'],
  ['.py', 'Python'],
  ['.java', 'Java'],
  ['.cs', 'C#'],
  ['.cpp', 'C++'],
  ['.cc', 'C++'],
  ['.cxx', 'C++'],
  ['.c', 'C'],
  ['.h', 'C/C++ Header'],
  ['.hpp', 'C++ Header'],
  ['.html', 'HTML'],
  ['.css', 'CSS'],
  ['.scss', 'SCSS'],
  ['.sql', 'SQL'],
  ['.rb', 'Ruby'],
  ['.go', 'Go'],
  ['.rs', 'Rust'],
  ['.swift', 'Swift'],
  ['.kt', 'Kotlin'],
  ['.dart', 'Dart'],
  ['.vue', 'Vue'],
  ['.svelte', 'Svelte'],
  ['.json', 'JSON'],
  ['.xml', 'XML'],
]);

function parseCorsOrigins(value) {
  if (!value || value === 'true') return [];
  if (value === 'false') return false;
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
