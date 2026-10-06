#!/usr/bin/env bun
/**
 * Seed full education flow:
 * login → class → curriculum → chapter → lesson → session → exercise
 *
 * Usage: bun scripts/seed-edu-flow.ts
 * Requires the dev server to be running (port 8888).
 */
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/database/schema';
import { grades } from '../src/database/schema';

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return databaseUrl;
  const host = process.env.POSTGRES_HOST?.trim() || 'localhost';
  const port = process.env.POSTGRES_PORT?.trim() || '5433';
  const db = process.env.POSTGRES_DB?.trim() || 'backends_db';
  const user = process.env.POSTGRES_USER?.trim() || 'postgres';
  const password = process.env.POSTGRES_PASSWORD?.trim() || 'postgres';
  const url = new URL(`postgres://${host}:${port}/${db}`);
  url.username = user;
  url.password = password;
  return url.toString();
}

const BASE = 'http://localhost:8888';

// ── credentials ─────────────────────────────────────────────────────────────
const TUTOR_EMAIL = 'dang04223@gmail.com';
const TUTOR_PASSWORD = 'Admin@123456';

// ── helpers ──────────────────────────────────────────────────────────────────
async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data: T; message?: string; statusCode?: number };
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

function log(step: string, id: string) {
  console.log(`✓ ${step.padEnd(18)} id = ${id}`);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n── Seeding education flow ──────────────────────────────────\n');

  // DB client — only used to look up the grade ID (no suitable public API endpoint)
  const client = postgres(resolveDatabaseUrl());
  const db = drizzle(client, { schema });
  const [grade] = await db.select().from(grades).limit(1);
  await client.end();
  if (!grade) throw new Error('No grades found — run: bun run db:seed:grades first');
  const gradeId = grade.id;

  // 1. Login
  const auth = await post<{ accessToken: string; user: { id: string } }>(
    '/auth/login',
    { email: TUTOR_EMAIL, password: TUTOR_PASSWORD },
  );
  const token = auth.accessToken;
  const tutorId = auth.user.id;
  log('login', tutorId);

  // 2. Seed a student to attach to the exercise (reuse tutor as student for demo)
  const studentId = tutorId;

  const curriculum = await post<{ id: string }>(
    '/curriculum',
    {
      subject: 'Toán lớp 10',
      code: 'TL10' + String(Date.now()).slice(-2),
      grade: 10,
      courseTime: '9 tháng',
      description: 'Chương trình toán lớp 10',
      gradesId: gradeId,
    },
    token,
  );
  log('curriculum', curriculum.id);

  // 4. Class
  const cls = await post<{ id: string }>(
    '/classes',
    {
      name: 'Lớp Toán 10A - ' + Date.now(),
      subject: 'Toán',
      tutorId,
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      format: 'ONLINE',
      curriculumId: curriculum.id,
    },
    token,
  );
  log('class', cls.id);

  // 5. Chapter
  const chapter = await post<{ id: string }>(
    `/chapter/${curriculum.id}`,
    {
      title: 'Chương 1: Mệnh đề và tập hợp',
      description: 'Các khái niệm cơ bản về mệnh đề',
      order: 1,
    },
    token,
  );
  log('chapter', chapter.id);

  // 6. Lesson (curriculumId and chapterId are query params)
  const lesson = await post<{ id: string }>(
    `/lesson?curriculumId=${curriculum.id}&chapterId=${chapter.id}`,
    {
      title: 'Bài 1: Mệnh đề',
      description: 'Khái niệm mệnh đề, mệnh đề phủ định',
      order: 1,
    },
    token,
  );
  log('lesson', lesson.id);

  // 7. Session
  const now = new Date();
  const sessionStart = new Date(now.getTime() + 24 * 60 * 60 * 1000); // tomorrow
  const sessionEnd = new Date(sessionStart.getTime() + 90 * 60 * 1000); // +90 min

  const session = await post<{ id: string }>(
    '/sessions',
    {
      classId: cls.id,
      lessonId: lesson.id,
      tutorId,
      title: 'Buổi 1: Mệnh đề',
      sessionNumber: 1,
      startAt: sessionStart.toISOString(),
      endAt: sessionEnd.toISOString(),
      format: 'ONLINE',
    },
    token,
  );
  log('session', session.id);

  // 8. Exercise
  const exercise = await post<{ id: string }>(
    '/exercises',
    {
      tutorId,
      studentId,
      lessonId: lesson.id,
      sessionId: session.id,
      issueUrls: [],
      exerciseUrls: [],
    },
    token,
  );
  log('exercise', exercise.id);

  console.log('\n── Done ────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\n✗ Seed failed:', err.message ?? err);
  process.exit(1);
});
