#!/usr/bin/env bun
/**
 * Seed full curriculum demo data:
 *   tutor + 2 parents + 4 students
 *   → curriculum (3 chương, mỗi chương 3 bài; mỗi bài 1 file lý thuyết + 2 file bài tập)
 *   → class kéo dài ~3 tháng (start = today-45d, end = today+45d)
 *   → schedule Tue/Thu → class_sessions rải suốt 3 tháng (một số đã học/COMPLETED, một số chưa học/SCHEDULED)
 *   → exercises: bài nộp/chấm điểm/nhận xét của tutor cho các buổi đã học
 *
 * Usage: bun scripts/seed-curriculum-demo.ts
 * Optional: SEED_SUFFIX=<string> to avoid unique-constraint collisions on rerun (default: timestamp)
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/database/schema';
import {
  users,
  grades,
  curriculums,
  chapters,
  lessons,
  classes,
  classStudents,
  schedules,
  sessions,
  exercise,
} from '../src/database/schema';
import { hashData } from '../src/packages/helpers/hashingData.helper';

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

const suffix = (process.env.SEED_SUFFIX?.trim() || String(Date.now()).slice(-6)).toLowerCase();
const SHARED_PASSWORD = 'Demo@123456';

type FileRef = { name: string; url: string; key: string };

function file(kind: 'ly-thuyet' | 'bai-tap-1' | 'bai-tap-2', chapterIdx: number, lessonIdx: number): FileRef {
  const key = `curriculum-${suffix}/chuong-${chapterIdx}/bai-${lessonIdx}/${kind}.pdf`;
  return {
    name: `${kind}.pdf`,
    url: `https://res.cloudinary.com/demo/raw/upload/${key}`,
    key,
  };
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function log(step: string, id: string) {
  console.log(`✓ ${step.padEnd(16)} id = ${id}`);
}

const exerciseStatusValues = ['SUBMITTED', 'GRADED', 'RESUBMIT'] as const;

async function main() {
  console.log('\n── Seeding curriculum demo data ──────────────────────────────\n');
  const client = postgres(resolveDatabaseUrl());
  const db = drizzle(client, { schema });

  // ── 1. Grade ──────────────────────────────────────────────────────
  let [grade] = await db.select().from(grades).where(eq(grades.level, 10)).limit(1);
  if (!grade) {
    [grade] = await db
      .insert(grades)
      .values({ id: randomUUID(), name: 'Lớp 10', level: 10 })
      .returning();
  }
  log('grade', grade.id);

  // ── 2. Tutor: reuse existing account by default so data shows up under
  //    the login you already use (set SEED_TUTOR_EMAIL to override / empty to force a new demo tutor)
  const tutorEmail = process.env.SEED_TUTOR_EMAIL?.trim() ?? 'dang04223@gmail.com';
  let tutor: typeof users.$inferSelect | undefined;
  if (tutorEmail) {
    [tutor] = await db.select().from(users).where(eq(users.email, tutorEmail)).limit(1);
    if (!tutor) console.log(`(SEED_TUTOR_EMAIL "${tutorEmail}" not found — creating new demo tutor)`);
  }
  if (!tutor) {
    const tutorPassword = await hashData(SHARED_PASSWORD);
    [tutor] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: `tutor.${suffix}@demo.dev`,
        username: `tutor${suffix}`,
        firstName: 'Minh',
        lastName: 'Nguyễn',
        password: tutorPassword,
        role: 'TUTOR',
        isActive: true,
      })
      .returning();
  }
  log('tutor', tutor.id);

  // ── 3. Parents ────────────────────────────────────────────────────
  const parentPassword = await hashData(SHARED_PASSWORD);
  const parentNames = [
    { firstName: 'Hùng', lastName: 'Trần' },
    { firstName: 'Lan', lastName: 'Phạm' },
  ];
  const parentRows = await db
    .insert(users)
    .values(
      parentNames.map((p, i) => ({
        id: randomUUID(),
        email: `parent${i + 1}.${suffix}@demo.dev`,
        username: `parent${i + 1}${suffix}`,
        firstName: p.firstName,
        lastName: p.lastName,
        password: parentPassword,
        role: 'PARENT' as const,
        relationship: i === 0 ? 'Bố' : 'Mẹ',
        isActive: true,
      })),
    )
    .returning();
  parentRows.forEach((p, i) => log(`parent ${i + 1}`, p.id));

  // ── 4. Students (2 con / phụ huynh) ──────────────────────────────
  const studentPassword = await hashData(SHARED_PASSWORD);
  const studentNames = [
    { firstName: 'An', lastName: 'Trần' },
    { firstName: 'Bình', lastName: 'Trần' },
    { firstName: 'Chi', lastName: 'Phạm' },
    { firstName: 'Dũng', lastName: 'Phạm' },
  ];
  const studentRows = await db
    .insert(users)
    .values(
      studentNames.map((s, i) => ({
        id: randomUUID(),
        email: `student${i + 1}.${suffix}@demo.dev`,
        username: `student${i + 1}${suffix}`,
        firstName: s.firstName,
        lastName: s.lastName,
        password: studentPassword,
        role: 'STUDENT' as const,
        school: 'THPT Demo',
        parentId: parentRows[Math.floor(i / 2)].id,
        tutorId: tutor.id,
        gradesId: [grade.id],
        isActive: true,
      })),
    )
    .returning();
  studentRows.forEach((s, i) => log(`student ${i + 1}`, s.id));
  const studentIds = studentRows.map((s) => s.id);

  // ── 5. Curriculum ─────────────────────────────────────────────────
  const [curriculum] = await db
    .insert(curriculums)
    .values({
      id: randomUUID(),
      userId: tutor.id,
      gradesId: grade.id,
      subject: 'Toán lớp 10',
      code: `TL${suffix}`.slice(0, 6).toUpperCase(),
      grade: '10',
      courseTime: '3 tháng',
      description: 'Chương trình Toán lớp 10 - Học kỳ demo 3 tháng',
    })
    .returning();
  log('curriculum', curriculum.id);

  // ── 6. Chapters + Lessons (3 chương × 3 bài, mỗi bài 1 lý thuyết + 2 bài tập) ──
  const chapterTitles = [
    'Chương 1: Mệnh đề và tập hợp',
    'Chương 2: Hàm số bậc nhất và bậc hai',
    'Chương 3: Phương trình và bất phương trình',
  ];
  const lessonTitlesByChapter = [
    ['Bài 1: Mệnh đề', 'Bài 2: Tập hợp', 'Bài 3: Các phép toán trên tập hợp'],
    ['Bài 1: Hàm số bậc nhất', 'Bài 2: Hàm số bậc hai', 'Bài 3: Đồ thị hàm số bậc hai'],
    ['Bài 1: Phương trình bậc nhất, bậc hai', 'Bài 2: Bất phương trình', 'Bài 3: Hệ phương trình'],
  ];

  const allLessons: { id: string; theoryUrls: FileRef[]; exerciseUrls: FileRef[] }[] = [];
  for (let c = 0; c < chapterTitles.length; c++) {
    const [chapter] = await db
      .insert(chapters)
      .values({
        id: randomUUID(),
        curriculumId: curriculum.id,
        title: chapterTitles[c],
        order: c + 1,
      })
      .returning();
    log(`chapter ${c + 1}`, chapter.id);

    for (let l = 0; l < lessonTitlesByChapter[c].length; l++) {
      const theoryUrls = [file('ly-thuyet', c + 1, l + 1)];
      const exerciseUrls = [file('bai-tap-1', c + 1, l + 1), file('bai-tap-2', c + 1, l + 1)];
      const [lesson] = await db
        .insert(lessons)
        .values({
          id: randomUUID(),
          curriculumId: curriculum.id,
          chapterId: chapter.id,
          title: lessonTitlesByChapter[c][l],
          theoryUrls,
          exerciseUrls,
          order: l + 1,
        })
        .returning();
      log(`  lesson ${c + 1}.${l + 1}`, lesson.id);
      allLessons.push({ id: lesson.id, theoryUrls, exerciseUrls });
    }
  }

  // ── 7. Class (~3 tháng, hôm nay nằm giữa) ─────────────────────────
  const today = new Date();
  const classStart = addDays(today, -45);
  const classEnd = addDays(today, 45);

  const [cls] = await db
    .insert(classes)
    .values({
      id: randomUUID(),
      name: `Lớp Toán 10A - ${suffix}`,
      code: `L10A${suffix}`.slice(0, 20).toUpperCase(),
      subject: 'Toán',
      tuition: '1500000',
      format: 'ONLINE',
      startTime: classStart,
      endTime: classEnd,
      curriculumId: curriculum.id,
      studentsId: studentIds,
      tutorId: tutor.id,
      status: 'OPEN',
    })
    .returning();
  log('class', cls.id);

  await db.insert(classStudents).values(
    studentIds.map((studentId) => ({
      id: randomUUID(),
      classId: cls.id,
      studentId,
    })),
  );

  // ── 8. Schedule: học Thứ 3 & Thứ 5, 18:00-19:30 ──────────────────
  await db.insert(schedules).values([
    {
      id: randomUUID(),
      classId: cls.id,
      dayOfWeek: 'TUESDAY',
      startTime: '18:00',
      endTime: '19:30',
      format: 'ONLINE',
    },
    {
      id: randomUUID(),
      classId: cls.id,
      dayOfWeek: 'THURSDAY',
      startTime: '18:00',
      endTime: '19:30',
      format: 'ONLINE',
    },
  ]);
  log('schedule', cls.id);

  // ── 9. Sessions: mỗi Thứ 3 & Thứ 5 trong khoảng 3 tháng ──────────
  const sessionDates: Date[] = [];
  for (let d = new Date(classStart); d <= classEnd; d = addDays(d, 1)) {
    const dow = d.getDay(); // 2 = Tuesday, 4 = Thursday
    if (dow === 2 || dow === 4) {
      const start = new Date(d);
      start.setHours(18, 0, 0, 0);
      sessionDates.push(start);
    }
  }

  const commentPoolGraded = [
    'Làm bài tốt, nắm chắc kiến thức. Cần luyện thêm dạng bài nâng cao.',
    'Trình bày rõ ràng, còn sai vài lỗi tính toán nhỏ.',
    'Hiểu bài nhưng làm còn chậm, cần luyện tập thêm để tăng tốc độ.',
    'Rất tốt! Tiếp tục phát huy.',
  ];
  const commentPoolResubmit = [
    'Bài làm còn thiếu phần chứng minh, em làm lại và nộp lại nhé.',
    'Sai hướng tiếp cận ở câu 2, xem lại lý thuyết rồi làm lại.',
  ];

  let sessionNumber = 0;
  let completedCount = 0;
  let scheduledCount = 0;
  let exerciseCount = 0;

  for (const startAt of sessionDates) {
    sessionNumber += 1;
    const lesson = allLessons[(sessionNumber - 1) % allLessons.length];
    const endAt = new Date(startAt.getTime() + 90 * 60 * 1000);
    const isPast = startAt < today;
    const status = isPast ? 'COMPLETED' : 'SCHEDULED';
    if (isPast) completedCount++;
    else scheduledCount++;

    const [session] = await db
      .insert(sessions)
      .values({
        id: randomUUID(),
        classId: cls.id,
        lessonId: lesson.id,
        tutorId: tutor.id,
        title: `Buổi ${sessionNumber}`,
        sessionNumber,
        theoryUrls: lesson.theoryUrls,
        exerciseUrls: lesson.exerciseUrls,
        startAt,
        endAt,
        status,
        actualStartAt: isPast ? startAt : null,
        actualEndAt: isPast ? endAt : null,
      })
      .returning();

    if (isPast) {
      for (const studentId of studentIds) {
        const roll = Math.random();
        if (roll < 0.1) continue; // ~10% chưa nộp bài, không tạo record

        const exStatus: (typeof exerciseStatusValues)[number] =
          roll < 0.65 ? 'GRADED' : roll < 0.85 ? 'SUBMITTED' : 'RESUBMIT';

        await db.insert(exercise).values({
          id: randomUUID(),
          lessonId: lesson.id,
          sessionId: session.id,
          tutorId: tutor.id,
          studentId,
          issueUrls: lesson.exerciseUrls,
          exerciseUrls: [
            {
              name: 'bai-lam-hoc-sinh.pdf',
              url: `https://res.cloudinary.com/demo/raw/upload/submissions-${suffix}/${session.id}/${studentId}.pdf`,
              key: `submissions-${suffix}/${session.id}/${studentId}.pdf`,
            },
          ],
          status: exStatus,
          score:
            exStatus === 'GRADED'
              ? (Math.round((6 + Math.random() * 4) * 10) / 10).toFixed(1)
              : null,
          comment:
            exStatus === 'GRADED'
              ? commentPoolGraded[Math.floor(Math.random() * commentPoolGraded.length)]
              : exStatus === 'RESUBMIT'
                ? commentPoolResubmit[Math.floor(Math.random() * commentPoolResubmit.length)]
                : null,
          gradedAt: exStatus === 'GRADED' ? addDays(startAt, 1) : null,
        });
        exerciseCount++;
      }
    }
  }

  console.log(
    `\n✓ sessions          total = ${sessionNumber} (COMPLETED = ${completedCount}, SCHEDULED = ${scheduledCount})`,
  );
  console.log(`✓ exercises         total = ${exerciseCount}`);

  console.log('\n── Done ───────────────────────────────────────────────────────');
  console.log(`Suffix used: ${suffix} (set SEED_SUFFIX to control / avoid collisions on rerun)`);
  console.log(`Shared password for newly-created accounts (parents/students): ${SHARED_PASSWORD}`);
  console.log(`Tutor account used: ${tutor.email} (id = ${tutor.id})`);
  console.log(`Class id: ${cls.id} · Curriculum id: ${curriculum.id}`);

  await client.end({ timeout: 5 });
}

main().catch((err) => {
  console.error('\n✗ Seed failed:', err.message ?? err);
  process.exit(1);
});
