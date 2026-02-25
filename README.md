# Community Classes Full-Stack App

This repository is a full-stack starter for a community classes website.

Stack:
- Frontend: React + Vite (`apps/web`)
- Backend: Express + TypeScript (`apps/api`)
- Auth + Database: Supabase

Two roles are supported:
- `admin`: can create classes and view all classes
- `member`: can sign up, log in, view classes, and register

Role permissions are enforced in the backend API.

## Data Model (Supabase)

Run `apps/api/supabase/schema.sql` in Supabase SQL editor. It creates:
- `users` (links auth user IDs to roles)
- `community_classes`
- `class_registrations` (unique class/member registration)

`apps/api/prisma/schema.prisma` mirrors these tables for reference.

## 1. Create a Supabase project

Collect:
- Project URL
- Publishable key
- Service role key

## 2. Run database schema

Execute:
- `apps/api/supabase/schema.sql`

## 3. Configure backend env (local)

From repo root:

```powershell
copy apps\api\.env.example apps\api\.env
```

Set values in `apps/api/.env`:

```env
SUPABASE_URL="https://YOUR-PROJECT-ID.supabase.co"
SUPABASE_PUBLISHABLE_KEY="YOUR_SUPABASE_PUBLISHABLE_KEY"
SUPABASE_SERVICE_ROLE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY"
CORS_ORIGINS="https://YOUR-VERCEL-DOMAIN.vercel.app,http://localhost:5173"
PORT=4000
```

## 4. Configure frontend env (local)

```powershell
copy apps\web\.env.example apps\web\.env.local
```

Set:

```env
VITE_API_BASE_URL="http://localhost:4000"
```

## 5. Install dependencies

```bash
npm install
```

## 6. Run locally

```bash
npm run dev
```

- Web: `http://localhost:5173`
- API health: `http://localhost:4000/health`

## 7. API endpoints

Auth:
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`

Admin:
- `GET /api/admin/classes`
- `POST /api/admin/classes`

Member:
- `GET /api/member/classes`
- `POST /api/member/registrations`

Promote user to admin:

```sql
update public.users
set role = 'admin'
where id = 'USER_UUID_HERE';
```

## 8. Production setup (Render API + Vercel Web)

Important:
- Keep backend routes unchanged (`/api/...`).
- Do not add a trailing slash in `VITE_API_BASE_URL`.
- `VITE_API_BASE_URL` must be only the API origin, for example:
  - `https://YOUR-RENDER-API.onrender.com`
- Deployment definitions are included in:
  - `render.yaml`
  - `apps/web/vercel.json`

### 8.1 Render API service

Use `render.yaml` as the source of truth.

Deploy options:
1. In Render, create a **Blueprint** service from this repository (recommended).
2. Or create a Web Service manually and copy settings from `render.yaml`.

`render.yaml` defines:
- Runtime: `node`
- Build Command: `npm --workspace apps/api run build`
- Start Command: `npm --workspace apps/api run start`
- Health Check Path: `/health`

Set environment variables in Render:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app,http://localhost:5173`

### 8.2 Vercel Web project

Use `apps/web/vercel.json` as the source of truth.

Create/import a Vercel project and set:
- Root Directory: `apps/web`
- Build/Output settings: taken from `apps/web/vercel.json`

Set environment variable in Vercel:
- `VITE_API_BASE_URL=https://YOUR-RENDER-API.onrender.com`

Redeploy after setting env vars. Do not add a trailing slash.

### 8.3 Verify production

1. Open `https://YOUR-RENDER-API.onrender.com/health` and confirm `{"status":"ok"}`.
2. Open your Vercel URL and test signup/login.
3. If browser shows CORS errors, verify `CORS_ORIGINS` exactly matches your Vercel domain.
