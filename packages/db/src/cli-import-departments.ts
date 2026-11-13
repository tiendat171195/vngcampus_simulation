/** `pnpm db:import-departments <file.csv>`: adds departments from a CSV file (P3.4). */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb } from './client';
import { importDepartments, parseDepartmentsCsv } from './departments';

const file = process.argv[2];
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error('Usage: DATABASE_URL=… pnpm db:import-departments <file.csv>');
  console.error('The file has a header row "name,parent" and one department per row.');
  process.exit(1);
}
// pnpm runs this inside packages/db; a relative path means relative to where it was typed.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const rows = parseDepartmentsCsv(await readFile(path, 'utf8'));
const { db, close } = createDb(url, { maxConnections: 1 });
const { added, total } = await importDepartments(db, rows);
await close();
console.log(`${added} departments added, ${total} in total`);
