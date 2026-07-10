# Deploy — Ubuntu VM (Proxmox), Docker

## 1. Create your private data repo

```bash
cp -r fitness-app/data-example /srv/fitness-data
cd /srv/fitness-data
# replace the demo user:
cd /path/to/fitness-app/backend
uv run python -c "from app.auth import hash_password; print(hash_password('YOUR_PASSWORD'))"
# paste the hash into /srv/fitness-data/config/users.yaml; delete the demo user
# and the users/demo directory; create users/<yourname>/{workouts,metrics}
cd /srv/fitness-data && git init && git add -A && git commit -m init
```

## 2. Backup remote (separate local remote)

A bare repo elsewhere on your network (NAS, another VM, or a second disk):

```bash
# on the backup host:
git init --bare /backups/fitness-data.git
# in the data repo:
git remote add backup ssh://backup-host/backups/fitness-data.git   # or a file:// path on a mounted share
git push -u backup master
```

The app commits after each finished session and edit, and pushes to `backup`
once a day. Belt-and-suspenders alternative: a cron on the VM —
`0 3 * * * git -C /srv/fitness-data push backup`.

If the data repo runs as a bind mount into Docker, make sure the repo's
`user.name`/`user.email` are set (`git -C /srv/fitness-data config user.name fitness-app`)
so container commits succeed.

## 3. Run the stack

```bash
export DATA_DIR=/srv/fitness-data
export FITNESS_SECRET_KEY=$(openssl rand -hex 32)   # persist this (e.g. in a .env file)
export MCP_USER=<yourname>
docker compose up -d --build
```

App: `http://<vm>:8080` · MCP: `http://<vm>:8080/mcp` · API: `http://<vm>:8080/api/...`

## 4. Local debug (uv, no Docker)

```bash
cd backend
FITNESS_DATA_DIR=/srv/fitness-data uv run uvicorn app.main:app --reload    # :8000
cd ../frontend && npm run dev                                              # :5173, proxies /api
```

## 5. Away-from-home access: Tailscale

Deliberate choice: no offline sync queue, no public exposure. Install Tailscale
on the VM and your phone; the PWA at `http://<tailnet-name>:8080` works from a
hotel gym exactly as at home.

For installable-PWA + HTTPS niceties, `tailscale cert` + a Caddy `tls` block, or
Tailscale Serve in front of :8080.

## 6. Security posture (read once)

- Designed for LAN/Tailscale. Do **not** port-forward this to the internet:
  auth is a signed cookie over whatever transport you give it, there's no rate
  limiting, and the MCP endpoint is unauthenticated by design (it's pinned
  read-only to one user via `FITNESS_MCP_USER` and a read-only mount).
- `FITNESS_SECRET_KEY` signs sessions; rotate it to invalidate all logins.
- PII boundary: the public repo contains code + fake data only. Everything
  personal lives in `/srv/fitness-data`.

## 7. Multi-user notes

Each family member: a `users.yaml` entry + a `users/<name>/` tree. Users are
namespaced, not isolated — anyone who can log in hits the same API and any
authed user could technically query another user's endpoints if they crafted
requests (fine for a family, not for strangers). Per-user MCP = one `mcp`
service per user with different `FITNESS_MCP_USER` and port.
