/**
 * Print a sign-in link for an email, straight from the database. This is how
 * the first app admin signs in when the server sends no email.
 *
 *   sudo -u www-data npx tsx server/scripts/login-link.ts you@example.com \
 *     --db /var/lib/azgb/azgb.db --url https://app.example.com
 *
 * The link and its code work for 14 days. For it to open the app-admin pages,
 * the email must be in APP_ADMIN_EMAILS; any other email can sign in and see
 * the tournaments it organises or scores.
 */
import { openDb } from '../db';
import { issueSharedLogin, normalizeEmail } from '../auth';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = normalizeEmail(process.argv[2]);
if (!email) {
  console.error('Usage: login-link.ts <email> [--db /var/lib/azgb/azgb.db] [--url https://app.example.com]');
  process.exit(1);
}
const dbPath = arg('db') ?? process.env.DB_PATH ?? './data/azgb.db';
const appUrl = (arg('url') ?? process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

const db = openDb(dbPath);
const { token, code, expiresAt } = issueSharedLogin(db, { email, tournamentId: null, groupId: null });
db.close();

console.log(`Sign-in link for ${email} (valid until ${new Date(expiresAt).toLocaleString()}):\n`);
console.log(`  ${appUrl}/signin?token=${encodeURIComponent(token)}\n`);
console.log(`  or enter code ${code} on the sign-in page`);
