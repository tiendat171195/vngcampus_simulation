import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { uuidv7 } from './ids';
import { departments } from './schema';

export interface DepartmentRow {
  name: string;
  /** Name of the department this one belongs to, if any. */
  parent: string | null;
}

/** Splits one CSV line, honouring quotes ("a, b" and doubled "" inside quotes). */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/**
 * Reads a department list: a header row with `name` and optionally `parent`, then one row per
 * department. Blank lines are skipped; a parent must be listed in the same file.
 */
export function parseDepartmentsCsv(text: string): DepartmentRow[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const header = splitCsvLine(lines.shift() ?? '').map((cell) => cell.toLowerCase());
  const nameAt = header.indexOf('name');
  const parentAt = header.indexOf('parent');
  if (nameAt < 0) throw new Error('The first row must name the columns, with at least "name".');

  const rows: DepartmentRow[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const cells = splitCsvLine(line);
    const name = cells[nameAt] ?? '';
    if (!name) throw new Error(`Row ${index + 2}: the name is empty.`);
    if (name.length > 80)
      throw new Error(`Row ${index + 2}: the name is longer than 80 characters.`);
    if (seen.has(name)) throw new Error(`Row ${index + 2}: "${name}" is listed twice.`);
    seen.add(name);
    const parent = parentAt >= 0 ? cells[parentAt] || null : null;
    rows.push({ name, parent });
  }
  for (const [index, row] of rows.entries())
    if (row.parent && !seen.has(row.parent))
      throw new Error(`Row ${index + 2}: parent "${row.parent}" is not in the file.`);
  return rows;
}

/**
 * Adds the departments that are missing and sets every parent. Existing departments keep their
 * id (people stay in them); nothing is deleted. Safe to run again with the same file.
 */
export async function importDepartments(
  db: Db,
  rows: DepartmentRow[],
): Promise<{ added: number; total: number }> {
  return db.transaction(async (tx) => {
    const existing = new Map(
      (await tx.select({ id: departments.id, name: departments.name }).from(departments)).map(
        (row) => [row.name, row.id],
      ),
    );
    let added = 0;
    for (const row of rows) {
      if (existing.has(row.name)) continue;
      const id = uuidv7();
      await tx.insert(departments).values({ id, name: row.name });
      existing.set(row.name, id);
      added++;
    }
    for (const row of rows) {
      const id = existing.get(row.name) as string;
      const parentId = row.parent ? (existing.get(row.parent) ?? null) : null;
      await tx.update(departments).set({ parentId }).where(eq(departments.id, id));
    }
    return { added, total: existing.size };
  });
}
