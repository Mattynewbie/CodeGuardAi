# System Architecture and Implementation Guide

## 1. Architecture

The system uses a three-layer architecture:

```text
React Frontend
  - Supabase Auth login and registration
  - User/Admin dashboards
  - Drag-and-drop upload
  - Report viewing and PDF export

Node.js Analysis API
  - Secure upload validation
  - ZIP/RAR extraction
  - Source-code normalization
  - Similarity scoring
  - Optional local AI semantic analysis

Supabase
  - Auth
  - PostgreSQL database
  - Storage bucket for uploaded archives and reports
  - Row Level Security policies
```

## 2. Database Tables

The required tables are implemented in [`../supabase/schema.sql`](../supabase/schema.sql):

- `users`
- `projects`
- `uploaded_files`
- `extracted_code_files`
- `similarity_results`
- `matched_code_sections`
- `reports`
- `activity_logs`

The `users` table acts as a profile table linked to `auth.users`. Admin and User roles are stored in `users.role`.

## 3. Frontend Pages

The React app includes these primary screens:

- Login and registration
- User dashboard
- Project upload
- Similarity history
- Similarity report
- Admin dashboard
- User management
- Uploaded project monitoring

The app is responsive through CSS grid and flex layouts. Desktop shows dashboard columns, tablet stacks key panels, and mobile collapses navigation into compact horizontal controls.

## 4. Backend API

```text
GET  /health
POST /api/projects/analyze
```

`POST /api/projects/analyze` accepts `multipart/form-data` with a `project` file. It supports source files and `.zip`/`.rar` archives.

Recommended production additions:

- `GET /api/projects`
- `GET /api/reports/:id`
- `DELETE /api/projects/:id`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/role`

## 5. Similarity Algorithm

The score uses weighted evidence:

- Exact hash match for identical files
- Token cosine similarity for shared vocabulary and logic
- Identifier-normalized token comparison for renamed variables
- K-gram fingerprint Jaccard similarity for copied blocks
- Structure similarity for branches, loops, classes, and functions
- String similarity over normalized code
- Optional semantic similarity from a local open-source embedding model

The final project score is based on the strongest suspicious file pairs, with extra weight for repeated matches across a project.

## 6. AI Integration Plan

The implemented free/open-source approach is:

1. Use deterministic methods as the main detection engine.
2. Use local embeddings from Hugging Face Transformers.js for semantic comparison.
3. Generate plain-language explanations from the metrics and matched evidence.
4. Avoid paid APIs to keep the system deployable in schools.

Default local model:

- `Xenova/all-MiniLM-L6-v2` through Transformers.js

Possible future local models:

- CodeBERT or GraphCodeBERT through a separate Python microservice
- SentenceTransformers models hosted locally

The included backend uses a dynamic Transformers.js adapter. If the transformer cannot load, it falls back to a local semantic feature vector and records that status in the report.

## 7. Sample UI Pages

Implemented in the frontend:

- `AuthScreen`: login/register with role selection for demo mode
- `UserDashboard`: upload, recent checks, score cards
- `ReportView`: chart, suspicious file pairs, matched snippets, PDF export
- `AdminDashboard`: all projects, reports, users, delete controls

## 8. Security Considerations

- Never execute uploaded files.
- Validate MIME type and extension.
- Enforce upload limits.
- Scan archive entry paths before extraction.
- Ignore binary files and unsupported extensions.
- Store the Supabase service role key only on the backend.
- Use RLS policies for all user-owned data.
- Log uploads, checks, deletions, and admin role changes.
- Present results as review support, not final proof of misconduct.

## 9. Scope and Limitations

This project detects similarity, not intent. It can miss heavily rewritten solutions and may flag legitimate similarities caused by starter templates, required algorithms, or common boilerplate. Instructors should use the report as evidence for review, supported by course policy and student explanations.

The first thesis version should focus on:

- Programming assignment submissions
- Source files under 40 MB per archive
- School-managed users
- Similarity reports for instructor review
- Free infrastructure and local/open-source AI

Future work:

- LMS integration
- Git repository imports
- Language-specific AST parsers
- Cross-language similarity detection
- Batch assignment-level comparison
- Instructor annotation workflow
