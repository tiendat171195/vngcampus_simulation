/** `pnpm quiz:load <file.json>` — adds or updates quiz questions (by id) from a JSON list. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb, quizQuestions } from '@campus/db';
import { sql } from 'drizzle-orm';
import { prepareQuestions } from './prepare';

const file = process.argv[2];
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error('Usage: DATABASE_URL=… pnpm quiz:load <file.json>');
  process.exit(1);
}
let questions: ReturnType<typeof prepareQuestions>;
try {
  questions = prepareQuestions(
    JSON.parse(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8')),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const { db, close } = createDb(url, { maxConnections: 1 });
await db
  .insert(quizQuestions)
  .values(
    questions.map((question) => ({
      id: question.id,
      text: question.text,
      choices: question.choices,
      correctIndex: question.correctIndex,
      explanation: question.explanation ?? null,
      tags: question.tags,
    })),
  )
  .onConflictDoUpdate({
    target: quizQuestions.id,
    set: {
      text: sql`excluded.text`,
      choices: sql`excluded.choices`,
      correctIndex: sql`excluded.correct_index`,
      explanation: sql`excluded.explanation`,
      tags: sql`excluded.tags`,
      active: true,
    },
  });
await close();
console.log(`${questions.length} câu hỏi đã được nạp`);
