/**
 * Consistent copy of the live SQLite database (safe while the API runs).
 *
 *   npx tsx server/scripts/backup-db.ts /var/lib/azgb/azgb.db /var/backups/azgb
 *
 * Writes azgb-YYYY-MM-DDTHH-MM.db and keeps the newest 30. Suggested cron
 * (crontab -e as the API's user):
 *   15 * * * * cd /var/www/azgb && npx tsx server/scripts/backup-db.ts /var/lib/azgb/azgb.db /var/backups/azgb
 */
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [src = process.env.DB_PATH ?? './data/azgb.db', dir = './data/backups'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(':', '-');
const dest = join(dir, `azgb-${stamp}.db`);
const db = new Database(src, { readonly: true, fileMustExist: true });
await db.backup(dest);
db.close();
const old = readdirSync(dir).filter((f) => /^azgb-.*\.db$/.test(f)).sort().reverse().slice(30);
for (const f of old) rmSync(join(dir, f));
console.log(`Backed up ${src} to ${dest}`);
