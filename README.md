# CodeGuard AI: An AI-Integrated Source Code Similarity Checker

CodeGuard AI is a web system for detecting copied or slightly modified source code submissions. It combines Supabase Auth, Database, and Storage, a React dashboard, and a Node.js analysis API that extracts uploaded projects, normalizes source code, compares submissions, and produces readable similarity reports.

This repository now uses Git and GitHub as the official version control workflow. Do not share ZIP or RAR copies of the whole project. Every team member should work on a branch, commit regularly, push daily, and merge through Pull Requests.

## Project Structure

```text
.
├── backend/                 Node.js API for extraction and similarity analysis
├── frontend/                React + Vite user interface
├── supabase/schema.sql      Supabase database, RLS, and storage policies
├── supabase/seed_accounts.sql
├── docs/                    Architecture and deployment documentation
├── .env.example             Environment variable template
├── .gitignore               Files Git must not track
├── package.json             Workspace scripts
└── README.md                Project and Git workflow guide
```

## Installation

Install dependencies:

```bash
npm install
```

Copy environment variables:

```bash
copy .env.example .env
```

Start both apps:

```bash
npm run dev
```

The frontend runs on `http://localhost:5173` and the backend runs on `http://localhost:4100`.

Build and run production-style:

```bash
npm run serve
```

Run tests:

```bash
npm test
```

## Clone Instructions

After the GitHub repository is created, new members should clone it instead of copying folders:

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
npm install
copy .env.example .env
npm run dev
```

Each member must create their own `.env` file locally. Never commit `.env`.

## Initial Git Setup

Run these commands once from the project root.

```bash
git init
git add .
git commit -m "chore: initial project version"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/YOUR_REPOSITORY.git
git push -u origin main
```

Create the integration branch:

```bash
git checkout -b develop
git push -u origin develop
```

Recommended GitHub settings:

- Protect `main` so nobody pushes directly to production code.
- Require Pull Requests before merging into `main`.
- Require at least one reviewer before merging.
- Require tests to pass before merging when CI is added.
- Use `develop` as the default target branch for feature and bugfix Pull Requests.

## Branch Rules

`main`

- Stable production code only.
- Merge into `main` only from `develop` for planned releases or from `hotfix/*` for urgent fixes.
- Do not commit directly to `main`.

`develop`

- Integration branch for completed work.
- All normal feature and bugfix Pull Requests merge here first.
- This branch should always be runnable and testable.

`feature/feature-name`

- Used for new features.
- Branch from `develop`.
- Examples: `feature/authentication`, `feature/dashboard`, `feature/reports`.

`bugfix/bug-name`

- Used for normal bug fixes found during development or testing.
- Branch from `develop`.
- Example: `bugfix/report-filter-error`.

`hotfix/fix-name`

- Used for emergency fixes to production code.
- Branch from `main`.
- Merge back into both `main` and `develop`.
- Example: `hotfix/login-crash`.

## Team Workflow

Text-based workflow diagram:

```text
main
  ^
  | release PR
develop
  ^        ^        ^        ^
  |        |        |        |
feature/authentication
feature/dashboard
feature/reports
feature/settings
```

Four-member branch assignment:

```text
Member A: Authentication -> feature/authentication
Member B: Dashboard      -> feature/dashboard
Member C: Reports        -> feature/reports
Member D: Settings       -> feature/settings
```

Each member creates their branch from the latest `develop`:

```bash
git checkout develop
git pull origin develop
git checkout -b feature/authentication
```

Use the matching branch name for each member:

```bash
git checkout -b feature/dashboard
git checkout -b feature/reports
git checkout -b feature/settings
```

Pull latest changes while working:

```bash
git checkout develop
git pull origin develop
git checkout feature/authentication
git merge develop
```

Commit and push changes:

```bash
git status
git add .
git commit -m "feat: Added login system"
git push -u origin feature/authentication
```

Open a Pull Request on GitHub:

```text
base: develop
compare: feature/authentication
```

After review and testing, merge the Pull Request into `develop`.

When `develop` is ready for release, open a Pull Request:

```text
base: main
compare: develop
```

After merging into `main`, everyone updates their local branches:

```bash
git checkout main
git pull origin main
git checkout develop
git pull origin develop
```

## Daily Workflow

Morning:

```bash
git checkout develop
git pull origin develop
git checkout feature/your-feature-name
git merge develop
```

While coding:

```bash
git status
git add path/to/changed-file
git commit -m "feat: Describe the completed change"
```

Commit small working units. A good commit should be easy to explain and easy to undo.

Before finishing the day:

```bash
git status
git add .
git commit -m "feat: Describe today's completed work"
git push -u origin feature/your-feature-name
```

If there is nothing ready to commit:

```bash
git status
```

Only commit code that is intentional. Do not commit broken experiments unless your team agrees.

Open Pull Request:

```text
GitHub -> Pull requests -> New pull request
base: develop
compare: feature/your-feature-name
```

After your Pull Request is merged:

```bash
git checkout develop
git pull origin develop
git branch -d feature/your-feature-name
```

Delete the remote branch on GitHub after merge if the team no longer needs it.

## Commit Message Convention

Use short, professional messages:

```text
feat: Added login system
fix: Fixed session timeout
refactor: Improved database helper
style: Updated UI
docs: Updated README
test: Added authentication tests
chore: Updated dependencies
```

Recommended format:

```text
type: Short description
```

Common types:

- `feat`: new feature
- `fix`: bug fix
- `refactor`: code change that does not add a feature or fix a bug
- `style`: formatting or UI styling
- `docs`: documentation only
- `test`: tests
- `chore`: tooling, dependencies, or maintenance

## Common Git Commands

Check current branch and changed files:

```bash
git status
```

View commit history:

```bash
git log --oneline --graph --decorate --all
```

Create a branch:

```bash
git checkout -b feature/example-name
```

Switch branches:

```bash
git checkout develop
```

Add files:

```bash
git add .
```

Commit:

```bash
git commit -m "feat: Added example feature"
```

Push:

```bash
git push -u origin feature/example-name
```

Pull:

```bash
git pull origin develop
```

Merge another branch into your current branch:

```bash
git merge develop
```

See remote repositories:

```bash
git remote -v
```

## Rollback Guide

Safest beginner command: `git revert`.

`git revert` creates a new commit that undoes an older commit. It does not erase public history, so it is safer when other people already pulled your work.

View commit history:

```bash
git log --oneline
```

Restore a deleted or changed file from the latest commit:

```bash
git restore path/to/file
```

Restore a file from a specific commit:

```bash
git checkout COMMIT_HASH -- path/to/file
git add path/to/file
git commit -m "fix: Restored deleted file"
```

Undo the last commit but keep the changes in your working folder:

```bash
git reset --soft HEAD~1
```

Undo the last commit and remove the changes from the staging area, while keeping files changed:

```bash
git reset HEAD~1
```

Undo a commit safely after it has been pushed:

```bash
git revert COMMIT_HASH
git push
```

Roll back the branch to an older commit locally:

```bash
git reset --hard COMMIT_HASH
```

Use `git reset --hard` carefully. It removes uncommitted work and rewrites branch history. Prefer `git revert` when working with a team.

Recover accidentally deleted code:

```bash
git status
git restore path/to/deleted-file
```

Recover code using the reflog:

```bash
git reflog
git checkout COMMIT_HASH
```

If you find the lost version, create a recovery branch:

```bash
git checkout -b recovery/lost-work
```

Recover after a bad merge that has not been pushed:

```bash
git reset --hard ORIG_HEAD
```

Recover after a bad merge that was already pushed:

```bash
git log --oneline
git revert -m 1 MERGE_COMMIT_HASH
git push
```

## Merge Conflict Guide

Conflicts happen when two branches edit the same lines or when one branch deletes a file another branch changed.

Start by merging the latest `develop` into your branch:

```bash
git checkout feature/your-feature-name
git pull origin feature/your-feature-name
git fetch origin
git merge origin/develop
```

Identify conflicted files:

```bash
git status
```

Git marks conflicts inside files like this:

```text
<<<<<<< HEAD
Your current branch change
=======
Incoming branch change
>>>>>>> origin/develop
```

Resolve the file by choosing the correct code. To keep both changes, edit the file into the final intended version:

```text
Your current branch change
Incoming branch change
```

Then remove all conflict markers:

```text
<<<<<<<
=======
>>>>>>>
```

Test after resolving:

```bash
npm test
npm run build
```

Commit the resolved merge:

```bash
git add .
git commit -m "fix: Resolved merge conflicts with develop"
git push
```

Abort a merge if you are not ready to resolve it:

```bash
git merge --abort
```

## Contribution Guide

1. Start from `develop`.
2. Create a descriptive branch.
3. Pull latest changes before coding.
4. Commit small, meaningful changes.
5. Push your branch to GitHub.
6. Open a Pull Request into `develop`.
7. Ask at least one teammate to review.
8. Run tests before merging.
9. Delete the branch after it is merged.
10. Never push directly to `main`.

Pull Request checklist:

```text
[ ] Branch is up to date with develop
[ ] Code runs locally
[ ] Tests pass
[ ] No .env, logs, node_modules, uploads, or build files are committed
[ ] Pull Request description explains what changed
[ ] Screenshots are included for UI changes when helpful
```

GitHub will automatically show the repository checklist from `.github/PULL_REQUEST_TEMPLATE.md` when a new Pull Request is opened.

## Backup Strategy

- GitHub is the official remote backup.
- Push changes daily so work is not stored on only one laptop.
- Never send ZIP or RAR copies of the project as the source of truth.
- Never overwrite another member's work by copying folders.
- Commit frequently with meaningful messages.
- Keep `.env` private and share only `.env.example`.
- Keep generated files, logs, uploads, and dependencies out of Git.
- Use Pull Requests for review before merging shared branches.

## GitHub Repository Commands

Use this sequence when the remote repository already exists on GitHub:

```bash
git init
git add .
git commit -m "chore: initial project version"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/YOUR_REPOSITORY.git
git push -u origin main
git checkout -b develop
git push -u origin develop
```

If the remote is already configured:

```bash
git remote -v
git remote set-url origin https://github.com/YOUR_ORG/YOUR_REPOSITORY.git
```

## VS Code Integration

Recommended extensions:

- GitLens
- Git Graph
- GitHub Pull Requests
- Git History

Useful VS Code actions:

- Open Source Control with `Ctrl+Shift+G` to view changed files.
- Use GitLens file history to see who changed a line and when.
- Use Git Graph to visualize branches, commits, merges, and tags.
- Use GitHub Pull Requests to review and create PRs inside VS Code.
- Right-click a file and choose timeline or history actions to restore older versions.
- Use conflict editor buttons to accept current change, incoming change, both changes, or manually edit the final result.

## Supabase Setup

1. Create a free Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Run `supabase/seed_accounts.sql` if you want ready-made test accounts.
4. Create or verify the `project-uploads` storage bucket.
5. Add the project URL and keys to `.env`.
6. Restart the backend and frontend.

Seeded accounts:

```text
Admin:     admin@sourcecodechecker.edu      / Admin@12345
Professor: professor@sourcecodechecker.edu  / Professor@12345
```

Change these passwords after first login or edit the seed SQL before importing it.

## Analysis Pipeline

1. Validate uploaded file type, size, and filename.
2. Extract archives without executing code.
3. Keep only supported source files.
4. Strip comments and normalize identifiers, strings, and numbers.
5. Generate token vectors, structural signatures, and k-gram fingerprints.
6. Compare the new project against previous projects.
7. Combine exact hash, fingerprint, cosine, structure, string, and optional semantic scores.
8. Produce matched sections, renamed variable hints, suspicious file pairs, and a similarity report.

## Security Rules

- Uploaded code is never executed.
- File size and file count limits are enforced.
- Only known source-code extensions are analyzed.
- Archive paths are sanitized to reduce Zip Slip and RAR path traversal risk.
- Supabase Row Level Security separates users and admins.
- The backend checks authenticated user roles before returning admin data.
- Service role keys stay only on the backend.
- Reports store evidence snippets and hashes, not arbitrary executable outputs.

## Thesis Scope

This project is realistic for schools, instructors, and programming courses. It is intended to identify suspicious similarity and support human review. It should not be treated as a fully automated disciplinary decision system.
