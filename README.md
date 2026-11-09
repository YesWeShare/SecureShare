# SecureShare

SecureShare is a static marketing page and a separate file-transfer application. The browser encrypts each file with AES-256-GCM before upload. The NestJS API stores ciphertext in private local storage for development or a private S3-compatible bucket, and PostgreSQL stores transfer state and encrypted metadata.

## Local Development

Install Node.js LTS, then install the backend and frontend dependencies in their respective folders:

```powershell
cd secureshare/backend
npm install
Copy-Item .env.example .env
npm run opaque:setup
```

Put the generated OPAQUE setup string into the local backend `.env`. Generate a separate 32-byte `TRANSFER_LOOKUP_SECRET` with Node's `crypto.randomBytes(32).toString('hex')`. Keep both values stable across restarts and out of source control.

For a local Postgres-compatible development database, start PGlite in a separate terminal:

```powershell
npm run db:dev
```

Set `DATABASE_URL` in the backend `.env` to:

```text
postgresql://postgres:postgres@127.0.0.1:5433/postgres?pgbouncer=true&connection_limit=1
```

PGlite is for single-process development only. For deployment, use PostgreSQL and run `npm run prisma:migrate` from `secureshare/backend`.

Start the backend with `npm run start:dev` from `secureshare/backend`. In another terminal, install and start the frontend:

```powershell
cd secureshare/frontend
npm install
npm run dev
```

Open `http://localhost:5173/`. The Vite server maps `/share` to the dedicated sharing page and proxies `/api` to NestJS. Camera access is available on localhost during development and requires HTTPS in production.

Transfers support 1, 3, 5, or 10 days of storage. The selected duration starts at the confirmed upload-completion timestamp; the QR link and six-digit code stay attached to the same transfer until expiry. Downloads are repeatable while the transfer is active. The API blocks access at the exact expiry timestamp and its scheduled cleanup removes ciphertext within five minutes afterward.

## Production Configuration

Use a private S3 bucket with public access blocked. Configure `STORAGE_DRIVER=s3`, `S3_BUCKET`, and `S3_REGION`; provide AWS credentials through an instance/task role or the standard AWS SDK environment rather than frontend code. Configure `DATABASE_URL`, `TRANSFER_LOOKUP_SECRET`, `OPAQUE_SERVER_SETUP`, and an HTTPS `FRONTEND_ORIGIN`. Preserve the two server secrets across restarts. The build emits `_redirects` for `/share` and `/receive/*`; configure the production static host to honor these rewrites, serving `secureshare/frontend/dist/share/index.html` and `secureshare/frontend/dist/receive/index.html` respectively.

Local storage under `.private-storage` is development-only. Expired objects are deleted by the API cleanup task; database records are retained with an expired status. Rate limits and OPAQUE login sessions are process-local, so run one API instance unless shared Redis-backed state and throttling are added.

## Transfer Security Notes

File contents, filenames, MIME types, and hashes are encrypted in the browser. S3/local storage receives ciphertext only. The random AES file key is wrapped using the OPAQUE client export key; the six-digit code is not used as an AES key. QR links put the file key in the URL fragment, which browsers do not send in HTTP requests. Referrer headers are disabled.

The code-receive endpoint receives the six digits over HTTPS to locate the HMAC-indexed transfer before running OPAQUE. The raw code is not stored or logged, and OPAQUE's export key is not returned to the server. However, a malicious or compromised live API could use the transient code to derive that export key. Therefore, the current six-digit-only lookup does not provide key confidentiality against a malicious live API operator; it protects against database and object-storage disclosure. A stronger server-blind lookup requires an additional high-entropy transfer identifier or a separately designed oblivious lookup/PAKE service.

The sender's deletion capability is a random owner token returned once and held in page memory. Reloading the sender page loses that capability; authentication-backed transfer management is not yet implemented.