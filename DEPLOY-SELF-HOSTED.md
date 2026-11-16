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

The VPS runs Node apps with PM2 as `sbericsson` (kept alive by `pm2-sbericsson.service`),
so the API does too: no sudo to start or restart it. Its settings and database live in
`~/azgb-data`. Only nginx needs root.

```bash
mkdir -p ~/azgb-data/backups && chmod 700 ~/azgb-data
cp /var/www/azgb/server/.env.example ~/azgb-data/api.env       # production
cp /var/www/azgb/server/.env.example ~/azgb-data/api-dev.env   # dev
chmod 600 ~/azgb-data/*.env
# api.env:     PORT=8787  DB_PATH=/home/sbericsson/azgb-data/azgb.db      APP_URL=https://golfbender.app
# api-dev.env: PORT=8788  DB_PATH=/home/sbericsson/azgb-data/azgb-dev.db  APP_URL=https://dev.golfbender.app
# both: APP_ADMIN_EMAILS=you@example.com (SMTP_URL optional)
```

nginx (root): rate limits, the key file, and one include per site.

```bash
sudo cp nginx/conf.d/azgb-limits.conf /etc/nginx/conf.d/
sudo cp nginx/snippets/azgb-api.conf nginx/snippets/azgb-api-dev.conf /etc/nginx/snippets/
sudo install -m 600 /dev/null /etc/nginx/azgb-keys.conf   # then add:
#   set $openrouter_key "sk-or-...";   (empty string if you have none: AI commentary falls back)
#   set $golfcourse_key "...";
# In the 443 server block of each site add one line before `location / {`:
#   azgb, app-azgbscore (golfbender.app):  include /etc/nginx/snippets/azgb-api.conf;
#   dev-golfbender:                        include /etc/nginx/snippets/azgb-api-dev.conf;
sudo nginx -t && sudo systemctl reload nginx
```

Adding the production include before the cutover is harmless: the old app never calls `/api/`.

## 3. Dev site first

1. Deploy the branch: `bash /var/www/azgb/deploy-dev.sh` and pick `self-hosted-backend`
   (the first run builds the API and notes that no process exists yet).
2. Start the API once and save the PM2 list:

   ```bash
   cd /var/www/azgb-dev
   pm2 start server/dist/index.mjs --name azgb-api-dev \
     --node-args="--env-file=/home/sbericsson/azgb-data/api-dev.env"
   pm2 save
   curl -s https://dev.golfbender.app/api/config     # {"emailSignIn":false}
   ```

   Later deploys restart it automatically.
3. Copy your production tournaments in (Firestore is still readable):

   ```bash
   cd /var/www/azgb-dev
   npx tsx server/scripts/import-firestore.ts --env /var/www/azgb/.env \
     --db ~/azgb-data/azgb-dev.db --owner you@example.com --dry-run
   # looks right? run again without --dry-run
   ```

   `--owner` becomes the organiser of every imported tournament (repeat it for
   several). PINs are dropped. Add co-organisers, and optionally scorer emails, in the app.
4. Your first sign-in link:

   ```bash
   npx tsx server/scripts/login-link.ts you@example.com \
     --db ~/azgb-data/azgb-dev.db --url https://dev.golfbender.app
   ```

5. Test on real phones at https://dev.golfbender.app:
   - Open your link; you land on App Admin.
   - In a tournament, tap **Share sign-in link** on a group and text it to
     yourself. Open it on an iPhone in Safari, **and** in the home-screen app
     (paste the link or type the XXXX-XXXX code on the sign-in page).
   - Lock a few holes in airplane mode, turn it off, check they sync.
   - Open the public results link signed out.

## 4. Production cutover

Pick a quiet time: scorers need a new sign-in link after this.

1. Merge `self-hosted-backend` into `main` and push.
2. Import production data (from the dev checkout, which already has the tools):

   ```bash
   cd /var/www/azgb-dev
   npx tsx server/scripts/import-firestore.ts --env /var/www/azgb/.env \
     --db ~/azgb-data/azgb.db --owner you@example.com
   ```

3. `bash /var/www/azgb/deploy.sh`, then start the API once:

   ```bash
   cd /var/www/azgb
   pm2 start server/dist/index.mjs --name azgb-api \
     --node-args="--env-file=/home/sbericsson/azgb-data/api.env"
   pm2 save
   ```

4. Your sign-in link: `login-link.ts` as in step 3.4 with `--db ~/azgb-data/azgb.db --url https://golfbender.app`.
5. In the app, for each live tournament: share each group's sign-in link with
   its scorer; add co-organisers under Tournament Settings → Organisers and
   copy their links to them.
6. Close the old database to the public once you are happy: from your laptop,
   `firebase deploy --only firestore:rules` (the repo's rules now deny everything).
   Before this step you can roll back by pointing `dist` at the previous
   release (`ln -sfn releases/<older> dist.next && mv -T dist.next dist`),
   though scores entered in the new app would not be in Firestore.

## 5. Backups

The database is one file. Take a consistent copy every hour and keep 30
(`crontab -e` as `sbericsson`):

```
15 * * * * cd /var/www/azgb && npx tsx server/scripts/backup-db.ts /home/sbericsson/azgb-data/azgb.db /home/sbericsson/azgb-data/backups
```

Copy `~/azgb-data/backups` off the server now and then. Organisers can still
download a JSON backup of their tournament from Tournament Settings, and app
admins can restore one from the App Admin page.

## Troubleshooting

| Symptom | Check |
|---|---|
| App says "No connection" everywhere | `pm2 status`, `pm2 logs azgb-api --lines 50` |
| Lost your own sign-in | Run `login-link` again on the server |
| Link opens but the iPhone home-screen app is still signed out | Expected: it does not share Safari's sign-in. Paste the link or type its code on the app's sign-in page |
| "That link or code did not work" | Older than 14 days, or the group was reset or deleted: share a new link |
| Emailed links never arrive (only with SMTP) | The API log shows SMTP errors |
| Live updates stop | nginx must not buffer `/api/`: the config sets `proxy_buffering off` |
| AI commentary always the built-in text | `/etc/nginx/azgb-keys.conf` present and included; `curl -s -o /dev/null -w '%{http_code}' -X POST https://SITE/proxy/openrouter/chat/completions` should print 401 when signed out |
