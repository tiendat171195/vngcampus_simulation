/**
 * `pnpm missions:load <file.json>… [--draft] [--today[=YYYY-MM-DD]]` — adds missions written as
 * JSON (docs/06 §11) to the database at DATABASE_URL, published unless `--draft`. `--today`
 * moves daily missions to today (or the given day), Vietnam time, to try them out.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { vnDateOf } from '@campus/core';
import { createDb, missions, uuidv7 } from '@campus/db';
import { campusIndex } from '@campus/map-data/campus';
import { prepareMissions } from './prepare';

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith('--'));
const draft = args.includes('--draft');
const todayArg = args.find((arg) => arg.startsWith('--today'));
const today = todayArg ? todayArg.split('=')[1] || vnDateOf(new Date()) : undefined;
const url = process.env.DATABASE_URL;
if (files.length === 0 || !url) {
  console.error(
    'Usage: DATABASE_URL=… pnpm missions:load <file.json>… [--draft] [--today[=YYYY-MM-DD]]',
  );
  process.exit(1);
}

const cwd = process.env.INIT_CWD ?? process.cwd();
const prepared = [];
try {
  for (const file of files)
    prepared.push(
      ...prepareMissions(JSON.parse(await readFile(resolve(cwd, file), 'utf8')), campusIndex, {
        today,
      }),
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { db, close } = createDb(url, { maxConnections: 1 });
let failed = false;
for (const { definition, dailyDate, warnings } of prepared) {
  for (const warning of warnings) console.warn(`! ${definition.title.vi}: ${warning}`);
  const id = uuidv7();
  try {
    await db.insert(missions).values({
      id,
      kind: definition.kind,
      publishStatus: draft ? 'draft' : 'published',
      title: definition.title,
      description: definition.description,
      startsAt: new Date(definition.startsAt),
      endsAt: new Date(definition.endsAt),
      dailyDate,
      definition,
      mapVersion: definition.mapVersion,
    });
    console.log(
      `${draft ? 'nháp' : 'xuất bản'}  ${id}  ${definition.kind}${dailyDate ? ` ${dailyDate}` : ''}  ${definition.title.vi}`,
    );
  } catch (error) {
    failed = true;
    const unique =
      String(
        (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code,
      ) === '23505';
    console.error(
      unique
        ? `✗ ${definition.title.vi}: đã có nhiệm vụ ngày xuất bản cho ${dailyDate}.`
        : `✗ ${definition.title.vi}: ${String(error)}`,
    );
  }
}
await close();
process.exit(failed ? 1 : 0);
