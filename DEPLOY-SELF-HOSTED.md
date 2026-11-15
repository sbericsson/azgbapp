# Moving Golf Bender off Firebase

The app now runs its own API server (Node + SQLite) on the VPS, behind nginx.
Sign-in is by link (or the link's code), which organisers copy and text or
email themselves; PINs are gone. The server sends no email unless you give it
an SMTP account. This guide moves the dev
site first, then production. Every step is run on the VPS unless it says
otherwise.

What changes for people:

| Who | Before | After |
|---|---|---|
| Organiser | Tournament code + admin PIN | Opens a sign-in link from the app admin or a co-organiser (Organisers → **Copy sign-in link**) |
| Scorer | Tournament code + group PIN | Organiser taps **Share sign-in link** on the group and texts it; one tap signs the phone in for 60 days. No email needed |
| App admin | Blank code + master PIN | Email in `APP_ADMIN_EMAILS`; first link from the `login-link` command on the server |
| Spectator | Needed a group PIN | Opens results by tournament code, no sign-in |

## 1. Before you start

- **Node 20 or newer** on the VPS: `node -v`. The API uses `better-sqlite3`,
  which installs a prebuilt binary for Linux x64/arm64.
- Decide which emails are **app admins** (yours).
- Optional: an SMTP account, only if you want the app to send emails itself
  (people requesting a link by email, organisers emailing a group's link).
  Leave `SMTP_URL` empty otherwise.

How links work: a link and its code last 14 days and can be opened more than
once (Safari, then the home-screen app). A group's link signs a phone in to
that group; a second group's link adds that group to the same phone. If a link
goes to the wrong person, open the group's **Edit** and tap **Sign out this
group's phones…**, which also cancels its links, then share a new one.

## 2. One-time server setup

Replace `www-data` with the user that owns `/var/www/azgb` if it is different.

```bash
# Database directory, writable only by the service user
sudo mkdir -p /var/lib/azgb /etc/azgb
sudo chown www-data:www-data /var/lib/azgb

# API settings (production and dev)
sudo cp /var/www/azgb/server/.env.example /etc/azgb/api.env
sudo cp /var/www/azgb/server/.env.example /etc/azgb/api-dev.env
sudo chmod 600 /etc/azgb/*.env
sudo nano /etc/azgb/api.env       # APP_URL, APP_ADMIN_EMAILS (SMTP_URL optional)
sudo nano /etc/azgb/api-dev.env   # PORT=8788, DB_PATH=/var/lib/azgb/azgb-dev.db, APP_URL=https://dev.golfbender.app

# API keys for the nginx proxies (R15), outside git
sudo tee /etc/nginx/azgb-keys.conf >/dev/null <<'KEYS'
set $openrouter_key "sk-or-...";
set $golfcourse_key "...";
KEYS
sudo chmod 600 /etc/nginx/azgb-keys.conf
```

systemd units (one per site). Check the node path with `which node` and fix
`ExecStart` if it is not `/usr/bin/node`:

```bash
sudo cp /var/www/azgb/deploy/azgb-api.service /etc/systemd/system/azgb-api.service
sudo sed -e 's#/var/www/azgb$#/var/www/azgb-dev#' -e 's#api.env#api-dev.env#' \
  -e 's#Description=Golf Bender API#Description=Golf Bender API (dev)#' \
  /var/www/azgb/deploy/azgb-api.service | sudo tee /etc/systemd/system/azgb-api-dev.service >/dev/null
sudo systemctl daemon-reload
```

The deploy scripts restart the API with `sudo systemctl restart`. If you deploy
as a user without passwordless sudo, allow just that command
(`sudo visudo -f /etc/sudoers.d/azgb`):

```
youruser ALL=(root) NOPASSWD: /usr/bin/systemctl restart azgb-api, /usr/bin/systemctl restart azgb-api-dev
```

## 3. Dev site first

1. Copy the new nginx config for the dev site from the branch
   (`nginx/dev-golfbender`) to `/etc/nginx/sites-available/`, then
   `sudo nginx -t && sudo systemctl reload nginx`.
2. Deploy the branch: `bash /var/www/azgb/deploy-dev.sh` and pick
   `self-hosted-backend`. The first run builds the API but skips the restart
   if the unit is not enabled yet; enable it:
   `sudo systemctl enable --now azgb-api-dev`, then check
   `journalctl -u azgb-api-dev -n 20` shows "listening".
   Then get your first sign-in link:

   ```bash
   cd /var/www/azgb-dev
   sudo -u www-data npx tsx server/scripts/login-link.ts you@example.com \
     --db /var/lib/azgb/azgb-dev.db --url https://dev.golfbender.app
   ```
3. Copy your production tournaments in (Firestore is still readable):

   ```bash
   cd /var/www/azgb-dev
   sudo -u www-data npx tsx server/scripts/import-firestore.ts \
     --env /var/www/azgb/.env --db /var/lib/azgb/azgb-dev.db --owner you@example.com --dry-run
   # looks right? run again without --dry-run
   ```

   `--owner` becomes the organiser of every imported tournament (repeat it for
   several). PINs are dropped. Add co-organisers and each group's scorer email
   in the app afterwards.
4. Test on real phones at https://dev.golfbender.app:
   - Open your link; you land on App Admin.
   - In a tournament, tap **Share sign-in link** on a group and text it to
     yourself. Open it on an iPhone in Safari, **and** in the home-screen app
     (paste the link or type the XXXX-XXXX code on the sign-in page).
   - Lock a few holes in airplane mode, turn it off, check they sync.
   - Open the public results link signed out.

## 4. Production cutover

Pick a quiet time: scorers have to sign in again by email after this.

1. Merge `self-hosted-backend` into `main` and push.
2. Copy `nginx.site.conf` to the production site (keep your domain and the
   certbot lines), `sudo nginx -t && sudo systemctl reload nginx`.
3. `sudo systemctl enable azgb-api` (do not start it yet).
4. Import production data:

   ```bash
   cd /var/www/azgb && git pull && npm ci --include=dev
   sudo -u www-data npx tsx server/scripts/import-firestore.ts \
     --env /var/www/azgb/.env --db /var/lib/azgb/azgb.db --owner you@example.com
   ```

5. `bash /var/www/azgb/deploy.sh` (builds the app and the API, starts it).
6. Get your production sign-in link with `login-link` (as in step 3, with
   `--db /var/lib/azgb/azgb.db --url https://your-domain`).
7. In the app, for each live tournament: share each group's sign-in link with
   its scorer; add co-organisers under Tournament Settings → Organisers and
   copy their links to them.
8. Close the old database to the public once you are happy: from your laptop,
   `firebase deploy --only firestore:rules` (the repo's rules now deny everything).
   Before this step you can roll back by pointing `dist` at the previous
   release (`ln -sfn releases/<older> dist.next && mv -T dist.next dist`),
   though scores entered in the new app would not be in Firestore.

## 5. Backups

The database is one file. Take a consistent copy every hour and keep 30
(`crontab -e` as `www-data`):

```
15 * * * * cd /var/www/azgb && npx tsx server/scripts/backup-db.ts /var/lib/azgb/azgb.db /var/backups/azgb
```

(`sudo mkdir -p /var/backups/azgb && sudo chown www-data /var/backups/azgb` first.)
Copy `/var/backups/azgb` off the server now and then. Organisers can still
download a JSON backup of their tournament from Tournament Settings, and app
admins can restore one from the App Admin page.

## Troubleshooting

| Symptom | Check |
|---|---|
| App says "No connection" everywhere | `systemctl status azgb-api`, `journalctl -u azgb-api -n 50` |
| Lost your own sign-in | Run `login-link` again on the server |
| Link opens but the iPhone home-screen app is still signed out | Expected: it does not share Safari's sign-in. Paste the link or type its code on the app's sign-in page |
| "That link or code did not work" | Older than 14 days, or the group was reset or deleted: share a new link |
| Emailed links never arrive (only with SMTP) | The API log shows SMTP errors |
| Live updates stop | nginx must not buffer `/api/`: the config sets `proxy_buffering off` |
| AI commentary always the built-in text | `/etc/nginx/azgb-keys.conf` present and included; `curl -s -o /dev/null -w '%{http_code}' -X POST https://SITE/proxy/openrouter/chat/completions` should print 401 when signed out |
