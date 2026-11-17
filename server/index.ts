import { serve } from '@hono/node-server';
import nodemailer from 'nodemailer';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from './db';
import { createApp } from './app';
import { normalizeEmail, type Mailer } from './auth';

/**
 * Golf Bender API server. Run behind nginx, which proxies /api/ to it.
 *
 * Environment (see server/.env.example):
 *   PORT                 default 8787, listens on 127.0.0.1 only
 *   DB_PATH              SQLite file, default ./data/azgb.db
 *   APP_URL              public origin used in emailed links
 *   APP_ADMIN_EMAILS     comma-separated emails that administer everything
 *   SMTP_URL             optional, e.g. smtps://user:pass@smtp.example.com:465. Without it
 *                        organisers copy and send sign-in links themselves
 *   MAIL_FROM            e.g. "Golf Bender <golf@example.com>"
 *   ALLOW_SELF_SERVICE   "false" to stop anyone creating tournaments at /create
 *   DEV_LOG_LINKS        "1" (with no SMTP_URL) prints sign-in emails to the console
 */

const env = process.env;
const port = Number(env.PORT ?? 8787);
const dbPath = env.DB_PATH ?? './data/azgb.db';
const appUrl = env.APP_URL ?? `http://localhost:5173`;

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

// Email is optional: without SMTP, organisers copy and send sign-in links
// themselves and the "email me a link" form is hidden.
let mailer: Mailer | null = null;
if (env.SMTP_URL) {
  const transport = nodemailer.createTransport(env.SMTP_URL);
  const from = env.MAIL_FROM ?? 'Golf Bender <no-reply@localhost>';
  mailer = async (mail) => {
    await transport.sendMail({ from, ...mail });
  };
} else if (env.DEV_LOG_LINKS === '1') {
  mailer = async (mail) => {
    console.log(`\n── Email to ${mail.to}: ${mail.subject}\n${mail.text}\n`);
  };
}

const app = createApp(db, mailer, {
  appUrl,
  appAdminEmails: new Set((env.APP_ADMIN_EMAILS ?? '').split(',').map(normalizeEmail).filter((e): e is string => !!e)),
  allowSelfService: env.ALLOW_SELF_SERVICE !== 'false',
  secureCookies: appUrl.startsWith('https://'),
});

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`Golf Bender API listening on http://127.0.0.1:${info.port} (db ${dbPath})`);
});

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
