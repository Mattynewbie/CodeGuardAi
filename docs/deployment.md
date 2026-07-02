# Deployment Notes

The project can run as one Node service in production:

1. Build the React app.
2. Start the Express API.
3. Express serves `frontend/dist` and the `/api/*` backend routes.

## Production Command

```bash
npm ci
npm run build
npm run start
```

## Required Environment Variables

```bash
PORT=4100
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=project-uploads
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_API_URL=
MAX_UPLOAD_MB=40
ENABLE_LOCAL_AI=true
LOCAL_AI_MODEL=Xenova/all-MiniLM-L6-v2
```

For a single-service deployment, leave `VITE_API_URL` empty before building so the frontend calls the same host.

## Live Setup Checklist

- Run `supabase/schema.sql` in the Supabase SQL Editor.
- Add all environment variables in the hosting dashboard.
- Set the public web service command to `npm run serve`.
- Keep `SUPABASE_SERVICE_ROLE_KEY` on the backend only.
- Promote the first instructor account to admin from Supabase SQL.
- Test `/health` after deployment.

## Notes

The local fallback store is useful for development and capstone demos, but production data should use Supabase. Uploaded code is parsed and compared only; it is never executed.

Set `ENABLE_LOCAL_AI=true` for the thesis build. The server uses `@huggingface/transformers` locally, so no paid model API key is required.
