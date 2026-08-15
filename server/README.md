# MAHO backend

Production-hardened Node.js/Express API for the MAHO store: central catalog,
email-verified accounts, orders, and **secure image uploads**. The same process
serves `website/` so one deploy URL hosts shop + API.

## Security requirements

| Rule | Behaviour |
| --- | --- |
| `ADMIN_PASSWORD` | **Required**. No default. Min 12 chars, letters + numbers, not a common password. Process exits otherwise. |
| Production (`NODE_ENV=production`) | Requires configured SMTP (`SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`) and **forbids** `ALLOW_DEV_CODES=true`. Never returns `devCode`. |
| Dev codes | Only when `NODE_ENV≠production` **and** `ALLOW_DEV_CODES=true`. |
| Images | Upload via `POST /api/admin/upload`. Files land in persistent `UPLOAD_DIR` (default `data/uploads`). Catalog stores `/uploads/…` URLs only — Base64 is stripped. |
| Admin panel | Backend login only. No localStorage password fallbacks. Saves go to the API. |
| CORS | Set `ALLOWED_ORIGINS` (comma-separated). In production, missing/empty list blocks browser cross-origin calls. |

## Run locally (development)

```bash
cd server
npm install
ADMIN_PASSWORD='SecureTestPass1' \
ALLOW_DEV_CODES=true \
ALLOWED_ORIGINS='http://localhost:4000' \
npm start
```

- Store: http://localhost:4000/
- Admin: http://localhost:4000/admin.html (password = `ADMIN_PASSWORD`)
- Health: http://localhost:4000/api/health

## Production example

```bash
NODE_ENV=production \
ADMIN_PASSWORD='your-long-unique-password' \
ALLOW_DEV_CODES=false \
SMTP_HOST=smtp.example.com SMTP_PORT=587 \
SMTP_USER=… SMTP_PASS=… SMTP_FROM='MAHO <orders@example.com>' \
ALLOWED_ORIGINS='https://shop.example.com,https://maho-api.example.com' \
DATA_DIR=/var/lib/maho \
UPLOAD_DIR=/var/lib/maho/uploads \
npm start
```

Mount a **persistent disk** on `DATA_DIR` / `UPLOAD_DIR` so `db.json` and uploaded images survive restarts (Render, Railway, VPS, etc.).

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Listen port | `4000` |
| `NODE_ENV` | `production` enables hard SMTP / no-devCode rules | `development` |
| `ADMIN_PASSWORD` | Admin API password | **required** |
| `ALLOW_DEV_CODES` | Return `devCode` in auth responses (dev only) | unset / false |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist | empty (open in dev, blocked in prod) |
| `DATA_DIR` | JSON DB directory | `server/data` |
| `UPLOAD_DIR` | Image storage | `$DATA_DIR/uploads` |
| `SMTP_*` | Real email delivery | empty |

## API (summary)

- `GET /api/health`, `GET /api/catalog`
- `POST /api/admin/login` → token
- `GET /api/admin/state`, `PUT /api/admin/catalog`, `POST /api/admin/upload`
- `GET /api/admin/orders`, `GET /api/admin/customers`, `POST /api/admin/orders/:id/status`
- `POST /api/auth/register` → verify → token; `POST /api/auth/login`
- `GET/PUT /api/me`, `POST /api/me/verify-email`
- `POST /api/orders`, `GET /api/orders`, cancel / return

Admin/user endpoints expect `Authorization: Bearer <token>`.
Uploads: `multipart/form-data` field `files` (jpeg/png/webp/gif, max 2 MB each).
