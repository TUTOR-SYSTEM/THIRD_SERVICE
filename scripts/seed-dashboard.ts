#!/usr/bin/env bun
/**
 * Seed dashboard + charts data for a tutor account.
 *
 * Populates everything the /dashboard/overview endpoint aggregates:
 *   classes → class_students → class_sessions → tuitions (+ notifications)
 * so the stat tiles, "today schedule", and the monthly revenue / sessions
 * charts all render with realistic data.
 *
 * Idempotent: on each run it removes previously seeded classes (code prefix
 * `DSH-`) owned by the tutor — cascade drops their sessions / tuitions /
 * enrollments — then recreates a fresh set. Students are upserted by email.
 *
 * Usage:
 *   bun scripts/seed-dashboard.ts                      # default tutor
 *   TUTOR_EMAIL=someone@x.com bun scripts/seed-dashboard.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { and, eq, ilike, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/database/schema';
import {
  users,
  classes,
  classStudents,
  sessions,
  tuitions,
  notifications,
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

const TUTOR_EMAIL = process.env.TUTOR_EMAIL?.trim() || 'dang04223@gmail.com';
const CODE_PREFIX = 'DSH-';

// ── deterministic-ish helpers ───────────────────────────────────────────────
function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}
function money(n: number): string {
  return n.toFixed(2);
}

const FIRST_NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khoa', 'Linh', 'Minh', 'Nam', 'Quân'];
const LAST_NAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi'];

const CLASS_DEFS = [
  { name: 'Toán 10A', subject: 'Toán', tuition: 800_000, weekday: 1 /* Mon */ },
  { name: 'Vật Lý 11B', subject: 'Vật Lý', tuition: 900_000, weekday: 3 /* Wed */ },
  { name: 'Hóa Học 12C', subject: 'Hóa Học', tuition: 1_000_000, weekday: 5 /* Fri */ },
  { name: 'Tiếng Anh 9D', subject: 'Tiếng Anh', tuition: 700_000, weekday: 2 /* Tue */ },
] as const;

const NUM_STUDENTS = 10;

async function main(): Promise<void> {
  const client = postgres(resolveDatabaseUrl());
  const db = drizzle(client, { schema });

  try {
    // 1. Resolve tutor (create if missing) ─────────────────────────────────
    let [tutor] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(ilike(users.email, TUTOR_EMAIL))
      .limit(1);

    if (!tutor) {
      const id = randomUUID();
      await db.insert(users).values({
        id,
        email: TUTOR_EMAIL,
        username: 'tutor_' + id.slice(0, 8),
        firstName: 'Tutor',
        lastName: 'Demo',
        password: await hashData('Tutor@123456'),
        role: 'TUTOR',
      });
      tutor = { id, role: 'TUTOR' };
      console.log(`✓ created tutor ${TUTOR_EMAIL}`);
    }
    const tutorId = tutor.id;
    console.log(`✓ tutor       ${TUTOR_EMAIL} (${tutorId})`);

    // 2. Upsert students ───────────────────────────────────────────────────
    const studentIds: string[] = [];
    const hashed = await hashData('Student@123456');
    for (let i = 0; i < NUM_STUDENTS; i++) {
      const email = `dsh.student${i + 1}@student.dev`;
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(ilike(users.email, email))
        .limit(1);
      if (existing) {
        studentIds.push(existing.id);
        continue;
      }
      const id = randomUUID();
      await db.insert(users).values({
        id,
        email,
        username: `dsh_student${i + 1}`,
        firstName: pick(FIRST_NAMES, i),
        lastName: pick(LAST_NAMES, i),
        password: hashed,
        role: 'STUDENT',
      });
      studentIds.push(id);
    }
    console.log(`✓ students    ${studentIds.length}`);

    // 3. Wipe previously seeded classes (cascade removes sessions/tuitions/enrollments)
    const deleted = await db
      .delete(classes)
      .where(and(eq(classes.tutorId, tutorId), like(classes.code, `${CODE_PREFIX}%`)))
      .returning({ id: classes.id });
    if (deleted.length) console.log(`✓ cleaned     ${deleted.length} old seeded classes`);

    const now = new Date();
    const year = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-based

    let totalSessions = 0;
    let totalTuitions = 0;
    let paidRevenue = 0;

    // 4. Create classes + enrollments + sessions + tuitions ────────────────
    for (let c = 0; c < CLASS_DEFS.length; c++) {
      const def = CLASS_DEFS[c];
      const classId = randomUUID();
      await db.insert(classes).values({
        id: classId,
        name: def.name,
        code: `${CODE_PREFIX}${year}-${c + 1}-${randomUUID().slice(0, 4)}`,
        subject: def.subject,
        tuition: money(def.tuition),
        description: `Lớp ${def.name} — dữ liệu demo dashboard`,
        status: 'OPEN',
        format: c % 2 === 0 ? 'OFFLINE' : 'ONLINE',
        location: c % 2 === 0 ? 'Phòng A' + (c + 1) : null,
        startTime: new Date(year, 0, 5),
        endTime: new Date(year, 11, 20),
        tutorId,
      });

      // Enroll a rotating slice of students (4–7 per class)
      const enrollCount = 4 + (c % 4);
      const enrolled: string[] = [];
      for (let k = 0; k < enrollCount; k++) {
        const sid = pick(studentIds, c * 3 + k);
        if (enrolled.includes(sid)) continue;
        enrolled.push(sid);
      }
      await db
        .insert(classStudents)
        .values(enrolled.map((studentId) => ({ classId, studentId })))
        .onConflictDoNothing();

      // Sessions: one per week on the class weekday, across the whole year.
      const sessionRows: (typeof sessions.$inferInsert)[] = [];
      let sessionNumber = 0;
      const cursor = new Date(year, 0, 1);
      // advance to first matching weekday
      while (cursor.getDay() !== def.weekday) cursor.setDate(cursor.getDate() + 1);
      while (cursor.getFullYear() === year) {
        sessionNumber++;
        const startAt = new Date(cursor);
        startAt.setHours(18, 0, 0, 0);
        const endAt = new Date(startAt.getTime() + 90 * 60 * 1000);
        const isPast = startAt < now;
        sessionRows.push({
          classId,
          tutorId,
          title: `Buổi ${sessionNumber}: ${def.subject}`,
          sessionNumber,
          startAt,
          endAt,
          format: c % 2 === 0 ? 'OFFLINE' : 'ONLINE',
          location: c % 2 === 0 ? 'Phòng A' + (c + 1) : null,
          status: isPast ? 'COMPLETED' : 'SCHEDULED',
        });
        cursor.setDate(cursor.getDate() + 7);
      }
      // Guarantee a session TODAY (drives "today schedule" + "this week") for first 2 classes
      if (c < 2) {
        const s = new Date(now);
        s.setHours(c === 0 ? 17 : 19, 30, 0, 0);
        const e = new Date(s.getTime() + 90 * 60 * 1000);
        sessionRows.push({
          classId,
          tutorId,
          title: `Buổi hôm nay: ${def.subject}`,
          sessionNumber: ++sessionNumber,
          startAt: s,
          endAt: e,
          format: c % 2 === 0 ? 'OFFLINE' : 'ONLINE',
          location: c % 2 === 0 ? 'Phòng A' + (c + 1) : null,
          status: 'SCHEDULED',
        });
      }
      await db.insert(sessions).values(sessionRows);
      totalSessions += sessionRows.length;

      // Tuitions: one per student per month (Jan..currentMonth+1).
      // Past months → PAID with paidDate in that month (feeds the revenue chart).
      // Current month → UNPAID. A slice of past ones → OVERDUE for variety.
      const tuitionRows: (typeof tuitions.$inferInsert)[] = [];
      for (let s = 0; s < enrolled.length; s++) {
        const studentId = enrolled[s];
        for (let m = 0; m <= currentMonth; m++) {
          const amount = def.tuition;
          const dueDate = new Date(year, m, 10);
          let status: 'PAID' | 'UNPAID' | 'OVERDUE';
          let paidDate: Date | null = null;
          if (m < currentMonth) {
            // ~15% of past dues left as OVERDUE, rest PAID
            if ((s + m) % 7 === 0) {
              status = 'OVERDUE';
            } else {
              status = 'PAID';
              paidDate = new Date(year, m, 8 + ((s + m) % 10));
              paidRevenue += amount;
            }
          } else {
            status = 'UNPAID';
          }
          tuitionRows.push({
            classId,
            studentId,
            amount: money(amount),
            dueDate,
            paidDate,
            status,
            note: `Học phí tháng ${m + 1}/${year}`,
          });
        }
      }
      await db.insert(tuitions).values(tuitionRows);
      totalTuitions += tuitionRows.length;

      console.log(
        `  · ${def.name.padEnd(14)} students=${enrolled.length} sessions=${sessionRows.length} tuitions=${tuitionRows.length}`,
      );
    }

    // 5. A few recent notifications for the tutor ──────────────────────────
    await db
      .delete(notifications)
      .where(and(eq(notifications.userId, tutorId), ilike(notifications.title, '[demo]%')));
    const notes = [
      { type: 'TUITION' as const, title: '[demo] Học phí mới được thanh toán', content: 'Một học sinh vừa đóng học phí tháng này.' },
      { type: 'STUDENT' as const, title: '[demo] Học sinh mới đăng ký', content: 'Có học sinh mới tham gia lớp Toán 10A.' },
      { type: 'SYSTEM' as const, title: '[demo] Nhắc lịch dạy', content: 'Bạn có buổi dạy hôm nay lúc 17:30.' },
      { type: 'TUTOR' as const, title: '[demo] Báo cáo tuần', content: 'Tổng kết hoạt động giảng dạy trong tuần đã sẵn sàng.' },
    ];
    await db.insert(notifications).values(
      notes.map((n, i) => ({
        userId: tutorId,
        type: n.type,
        title: n.title,
        content: n.content,
        actionType: 'VIEW' as const,
        isRead: i > 1,
        createdAt: new Date(now.getTime() - i * 3_600_000),
      })),
    );
    console.log(`✓ notifications ${notes.length}`);

    console.log('\n── Summary ─────────────────────────────────────────────');
    console.log(`  classes:       ${CLASS_DEFS.length}`);
    console.log(`  students:      ${studentIds.length}`);
    console.log(`  sessions:      ${totalSessions}`);
    console.log(`  tuitions:      ${totalTuitions}`);
    console.log(`  paid revenue:  ${paidRevenue.toLocaleString('vi-VN')} đ (year ${year})`);
    console.log(`\n✓ Done. Log in as ${TUTOR_EMAIL} and open the dashboard.\n`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
