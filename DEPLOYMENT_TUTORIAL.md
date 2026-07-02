# CodeGuard AI Deployment Tutorial

This guide shows how to deploy CodeGuard AI so your groupmates can test it online.

## Recommended Platform: Render

Render is the easiest option for this project because CodeGuard AI can run as one Node.js web service. The backend serves the built frontend from `frontend/dist`, so users only need one public URL.

## Before Deploying

Make sure the project builds locally:

```bash
npm install
npm run build
npm test
```

Then push the project to GitHub.

## Render Setup

1. Go to Render.
2. Create a new **Web Service**.
3. Connect your GitHub repository.
4. Use these settings:

```txt
Runtime: Node
Build Command: npm install && npm run build
Start Command: npm start
```

The root `package.json` already supports this:

```txt
npm run build  -> builds the frontend
npm start      -> starts the Express backend
```

## Environment Variables

Add these variables in Render under **Environment**.

```txt
NODE_ENV=production
PORT=4100

SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_STORAGE_BUCKET=project-uploads

VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

AI_CHAT_API_URL=https://gpt-api-bay.vercel.app/chat
AI_CHAT_API_FORMAT=messages
ENABLE_LOCAL_AI=false
ENABLE_REPORT_ASSISTANT_AI=false

MAX_UPLOAD_MB=100
MAX_TOTAL_EXTRACTED_MB=25
```

After Render gives you a public URL, add this too:

```txt
CORS_ORIGIN=https://your-render-app-name.onrender.com
```

Then redeploy.

## Important Frontend Note

The file `frontend/.env.production` sets:

```txt
VITE_API_URL=
```

This is intentional. In production, the frontend and backend are served from the same Render URL, so API requests should use same-origin paths like `/api/projects`.

Do not set `VITE_API_URL=http://localhost:4100` in production.

## Supabase Checklist

Before testing online:

1. Make sure your Supabase project is active.
2. Make sure the storage bucket exists:

```txt
project-uploads
```

3. Make sure your database tables and policies from the project SQL setup are already applied.
4. Use the correct Supabase keys:

```txt
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Only put the service role key in the backend environment variables. Never expose it in frontend variables.

## AI Assistant Notes

The AI Report Assistant uses:

```txt
https://gpt-api-bay.vercel.app/chat
```

This is a free demo endpoint, so it may sometimes be slow or return a timeout. The app has a fallback response so the chat should not fully break, but the best AI answers depend on the endpoint being available.

For a stronger production setup, replace it with an OpenAI-compatible endpoint:

```txt
AI_CHAT_API_URL=https://api.openai.com/v1/chat/completions
AI_CHAT_API_FORMAT=openai
AI_CHAT_API_KEY=your_api_key
AI_CHAT_MODEL=gpt-4o-mini
```

## Testing After Deployment

Open your Render URL and test:

1. Login or register.
2. Upload a source file or archive.
3. Check the generated report.
4. Open **AI Chat**.
5. Ask:

```txt
Explain the similarity score.
```

6. Test mobile view and the burger sidebar.

## Common Problems

### The frontend loads but API requests fail

Check:

```txt
CORS_ORIGIN
VITE_API_URL
```

For Render single-service deployment, `VITE_API_URL` should be blank in production.

### Uploads fail

Check:

```txt
MAX_UPLOAD_MB
MAX_TOTAL_EXTRACTED_MB
SUPABASE_STORAGE_BUCKET
SUPABASE_SERVICE_ROLE_KEY
```

Also confirm the uploaded file extension is supported.

### Reports do not persist

Check Supabase environment variables and database setup.

### AI chat is slow

The free AI endpoint may be cold-starting or temporarily unavailable. Wait and retry, or switch to an OpenAI-compatible provider.

## Railway Alternative

Railway can also run this project as one Node service.

Use:

```txt
Build Command: npm install && npm run build
Start Command: npm start
```

Set the same environment variables listed above.

After Railway gives you a public URL, set:

```txt
CORS_ORIGIN=https://your-railway-url
```

Then redeploy.

## Final Sharing Step

Once deployed, send your groupmate the public URL.

Example:

```txt
https://codeguard-ai.onrender.com
```

They do not need to run anything locally.
