# MAHO backend

A small Node.js/Express API that makes the MAHO store **central and live**: one shared
catalog, customer accounts with **real email verification**, and orders/customers the
owner can see from anywhere (not just one browser).

Data is stored in a JSON file (`data/db.json`) — no database server needed. For higher
volume you can later swap the storage layer for a real database.

## Run locally

```bash
cd server
npm install
npm start           # http://localhost:4000
```

Health check: `GET http://localhost:4000/api/health`

## Configuration (environment variables)

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Port to listen on | `4000` |
| `ADMIN_PASSWORD` | Admin panel password | `maho1234` (change it!) |
| `DATA_DIR` | Where `db.json` is stored | `server/data` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | Email sending (verification + order confirmation) | empty |
| `ALLOW_DEV_CODES` | If `true`, verification codes are returned in the API response (no email needed). Auto-enabled when SMTP is not set. | auto |

When SMTP is **not** configured, the API runs in **dev mode**: registration/email-change
responses include `devCode` so the flow works without an email provider. Set the SMTP
variables (e.g. Gmail app password, or any provider) to send **real** emails and disable
dev codes.

## Deploy (free / low-cost options)

Any Node host works. Examples:

- **Render.com** (free web service): New → Web Service → connect this repo → Root
  Directory `server`, Build `npm install`, Start `npm start`. Add env vars (ADMIN_PASSWORD,
  SMTP_*). Use a persistent disk mounted at `server/data` so orders/customers survive
  restarts.
- **Railway.app / Fly.io / Cyclic**: similar — set root to `server`, start `npm start`.
- **Your own VPS**: `npm install && ADMIN_PASSWORD=... SMTP_...=... node index.js`, behind
  Nginx with HTTPS; keep it running with `pm2` or a systemd service.

After deploying you get a public URL like `https://maho-api.onrender.com`. Put that URL
into the website so the storefront/admin use the backend (frontend wiring is the next
step; the site keeps working offline against the built-in defaults until then).

## API (summary)

- `GET /api/health`, `GET /api/catalog`
- `POST /api/admin/login` → token; `GET /api/admin/state`, `PUT /api/admin/catalog`,
  `GET /api/admin/orders`, `GET /api/admin/customers`
- `POST /api/auth/register` → (email code) `POST /api/auth/verify` → token;
  `POST /api/auth/login`
- `GET/PUT /api/me`, `POST /api/me/verify-email`
- `POST /api/orders`, `GET /api/orders`, `POST /api/orders/:id/cancel`,
  `POST /api/orders/:id/return`

Admin/user endpoints expect `Authorization: Bearer <token>`.
