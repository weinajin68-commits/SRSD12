# SRSD Tutor Web

A minimal local website for continuation-writing students:

- student registration and login
- persistent chat conversations
- local SQLite storage for users, conversations, and messages
- OpenAI-powered SRSD tutoring using your prompt

## What is stored

The app stores all local data in [`data/app.db`](/Users/anna/srsd-tutor-web/data/app.db):

- users
- login sessions
- conversations
- student messages
- tutor messages
- raw OpenAI request and response JSON for each tutor reply

The OpenAI request in this app is sent with `store: false`, so the app keeps its own records locally instead of relying on OpenAI-side storage.

## Files

- server: [`server.js`](/Users/anna/srsd-tutor-web/server.js)
- prompt: [`prompts/srsd-teacher.txt`](/Users/anna/srsd-tutor-web/prompts/srsd-teacher.txt)
- database helpers: [`lib/db.js`](/Users/anna/srsd-tutor-web/lib/db.js)
- OpenAI integration: [`lib/openai.js`](/Users/anna/srsd-tutor-web/lib/openai.js)
- frontend pages: [`public/index.html`](/Users/anna/srsd-tutor-web/public/index.html), [`public/app.html`](/Users/anna/srsd-tutor-web/public/app.html)

## Run locally

1. Copy `.env.example` to `.env` if you have not already.
2. Put your real OpenAI API key into `.env`.
3. Optionally change `SESSION_SECRET`.
4. Start the app:

```bash
cd /Users/anna/srsd-tutor-web
node server.js
```

5. Open `http://127.0.0.1:3000`

## Deploy to Render

This repo now includes [`render.yaml`](/Users/anna/srsd-tutor-web/render.yaml) for a simple production deploy.

Key production settings:

- `HOST=0.0.0.0`
- `PORT=10000`
- `COOKIE_SECURE=true`
- `DATA_DIR=/var/data`
- health check path: `/health`
- persistent disk mount: `/var/data`

Why this setup:

- Render web services require your app to bind to `0.0.0.0`.
- Render disks preserve local files across restarts and deploys.
- This app keeps SQLite data under `DATA_DIR`, so the database survives deploys when `DATA_DIR` is on the mounted disk.

Basic steps:

1. Push this project to GitHub.
2. Create a new Render Blueprint or Web Service from that repo.
3. Set `OPENAI_API_KEY` in the Render dashboard.
4. Let Render deploy the app.
5. Add a custom domain in Render and point your DNS records to it.

For a detailed walkthrough, see Render docs:

- https://render.com/docs/web-services
- https://render.com/docs/disks
- https://render.com/docs/custom-domains

## Upload to GitHub

This folder is ready to become a GitHub repo. The files that should never be uploaded are already ignored in [`.gitignore`](/Users/anna/srsd-tutor-web/.gitignore):

- `.env`
- local SQLite database files under `data/`
- `node_modules`
- local log files

Suggested commands:

```bash
cd /Users/anna/srsd-tutor-web
git init -b main
git add .
git commit -m "Initial SRSD tutor web app"
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

Before pushing:

- make sure `.env` does not contain secrets you do not want stored locally
- keep your real `OPENAI_API_KEY` only in `.env` locally or in Render environment variables
- do not commit the `data/app.db` database

## Current limitation

In my current execution environment, binding a local HTTP port is blocked, so I could not complete an end-to-end browser run here. The code passes syntax checks, and the local database/runtime pieces were verified directly.

## Student-safety note

If your users are minors, review OpenAI’s Under 18 API Guidance and applicable privacy law requirements before deploying:

- https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance
- https://developers.openai.com/api/docs/guides/your-data
