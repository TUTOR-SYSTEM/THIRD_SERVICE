import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  pgEnum,
  uniqueIndex,
  index,
  type AnyPgColumn,
  numeric,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';

// ─── Enums ──────────────────────────────────────────────────────────
// Owner: USER (users/grades)
export const userRoleEnum = pgEnum('user_role', ['STUDENT', 'ADMIN', 'TUTOR', 'PARENT']);
export const genderEnum = pgEnum('gender', ['MALE', 'FEMALE', 'OTHER']);

// Owner: tutor-service (education domain)
export const classStatusEnum = pgEnum('class_status', ['OPEN', 'CLOSED', 'UPCOMING']);
export const sessionFormatEnum = pgEnum('session_format', ['ONLINE', 'OFFLINE']);
export const sessionStatusEnum = pgEnum('session_status', ['UPCOMING', 'COMPLETED', 'CANCELLED']);
export const classSessionStatusEnum = pgEnum('class_session_status', [
  'SCHEDULED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
  'POSTPONED',
]);
export const dayOfWeekEnum = pgEnum('day_of_week', [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);
export const curriculumStatusEnum = pgEnum('curriculum_status', ['COMPLETED', 'UPCOMING']);
export const assignmentStatusEnum = pgEnum('assignment_status', [
  'COMPLETED',
  'OVERDUE',
  'IN_PROGRESS',
]);
export const exerciseStatusEnum = pgEnum('exercise_status', ['SUBMITTED', 'GRADED', 'RESUBMIT']);
export const tuitionStatusEnum = pgEnum('tuition_status', ['PAID', 'UNPAID', 'OVERDUE']);
export const aiMessageRoleEnum = pgEnum('ai_message_role', ['USER', 'ASSISTANT']);
export const conversationTypeEnum = pgEnum('conversation_type', ['DIRECT', 'GROUP', 'CLASS']);
export const messageStatusEnum = pgEnum('message_status', ['SENT', 'DELIVERED', 'READ']);

// Owner: THIRD_SERVICE (notification + log)
export const notificationTypeEnum = pgEnum('notification_type', [
  'SYSTEM',
  'TUITION',
  'STUDENT',
  'TUTOR',
]);
export const notificationActionEnum = pgEnum('notification_action', [
  'VIEW',
  'CONTACT',
  'PAYMENT',
  'UPDATE',
]);
export const logTypeEnum = pgEnum('log_type', ['HTTP', 'RPC']);
export const testScenarioCategoryEnum = pgEnum('test_scenario_category', [
  'valid',
  'auth',
  'validation',
  'not_found',
  'domain',
]);

// ─── USER: users, grades ────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  firstName: varchar('first_name', { length: 255 }).notNull(),
  lastName: varchar('last_name', { length: 255 }).notNull(),
  password: text('password').notNull(),
  avatar: text('avatar'),
  phone: varchar('phone', { length: 20 }),
  isActive: boolean('is_active').default(true),
  role: userRoleEnum('role').default('STUDENT'),
  description: varchar('description', { length: 5000 }),
  userCode: varchar('userCode', { length: 6 }),
  gender: genderEnum('gender'),
  dateOfBirth: timestamp('date_of_birth'),
  address: text('address'),
  district: varchar('district', { length: 30 }),
  province: varchar('province', { length: 30 }),
  subjects: varchar('subjects', { length: 255 }),
  facebookId: varchar('facebookUrl', { length: 200 }),
  googleId: varchar('googleUrl', { length: 200 }),
  school: varchar('school', { length: 255 }),
  relationship: varchar('relationship', { length: 50 }),
  gradesId: uuid('grades_id').array().notNull().default([]),
  parentId: uuid('parent_id').references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
  tutorId: uuid('tutor_id').references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const grades = pgTable('grades', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  level: integer('level').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── tutor-service: education domain ────────────────────────────────
export const classes = pgTable('classes', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  subject: varchar('subject', { length: 255 }).notNull(),
  tuition: numeric('tuition', { precision: 14, scale: 2 }).default('0'),
  description: text('description'),
  status: classStatusEnum('status').default('OPEN'),
  format: sessionFormatEnum('format').notNull().default('ONLINE'),
  startTime: timestamp('start_time').defaultNow().notNull(),
  endTime: timestamp('end_time').defaultNow().notNull(),
  location: text('location'),
  curriculumId: uuid('curriculum_id').references(() => curriculums.id, { onDelete: 'set null' }),
  tutorId: uuid('tutor_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const classStudents = pgTable(
  'class_students',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('class_students_unique').on(table.classId, table.studentId)],
);

export const schedules = pgTable('schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  classId: uuid('class_id')
    .notNull()
    .references(() => classes.id, { onDelete: 'cascade' }),
  dayOfWeek: dayOfWeekEnum('day_of_week').notNull(),
  startTime: varchar('start_time', { length: 5 }).notNull(),
  endTime: varchar('end_time', { length: 5 }).notNull(),
  format: sessionFormatEnum('format').notNull().default('ONLINE'),
  location: text('location'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('class_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  classId: uuid('class_id')
    .notNull()
    .references(() => classes.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
  tutorId: uuid('tutor_id').references(() => users.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }),
  description: text('description'),
  sessionNumber: integer('session_number').notNull(),
  lessionId: uuid('lession_id').references(() => lessons.id, { onDelete: 'set null' }),
  theoryUrls: jsonb('theory_urls')
    .$type<{ name: string; url: string; key: string }[]>()
    .default([]),
  exerciseUrls: jsonb('exercise_urls')
    .$type<{ name: string; url: string; key: string }[]>()
    .default([]),
  startAt: timestamp('start_at', {
    withTimezone: true,
    mode: 'date',
  }).notNull(),
  endAt: timestamp('end_at', {
    withTimezone: true,
    mode: 'date',
  }).notNull(),
  location: text('location'),
  status: classSessionStatusEnum('status').default('SCHEDULED').notNull(),
  note: text('note'),
  actualStartAt: timestamp('actual_start_at', {
    withTimezone: true,
    mode: 'date',
  }),
  actualEndAt: timestamp('actual_end_at', {
    withTimezone: true,
    mode: 'date',
  }),
  objectives: jsonb('objectives').$type<string[]>().default([]),
  agenda: jsonb('agenda')
    .$type<{ time: string; title: string; description?: string }[]>()
    .default([]),
  exerciseDueAt: timestamp('exercise_due_at', {
    withTimezone: true,
    mode: 'date',
  }),
  createdAt: timestamp('created_at', {
    withTimezone: true,
    mode: 'date',
  })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', {
    withTimezone: true,
    mode: 'date',
  })
    .$onUpdate(() => new Date())
    .defaultNow()
    .notNull(),
});

export const curriculums = pgTable('curriculums', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  gradesId: uuid('grade_id').references(() => grades.id, { onDelete: 'cascade' }),
  subject: varchar('title', { length: 255 }).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  grade: varchar('grade', { length: 2 }).notNull(),
  courseTime: varchar('courseTime').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const chapters = pgTable('chapters', {
  id: uuid('id').defaultRandom().primaryKey(),
  curriculumId: uuid('curriculum_id')
    .notNull()
    .references(() => curriculums.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  order: integer('order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const lessons = pgTable('lessons', {
  id: uuid('id').defaultRandom().primaryKey(),
  curriculumId: uuid('curriculum_id')
    .notNull()
    .references(() => curriculums.id, { onDelete: 'cascade' }),
  chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  theoryUrls: jsonb('theory_urls')
    .$type<{ name: string; url: string; key: string }[]>()
    .default([]),
  exerciseUrls: jsonb('exercise_urls')
    .$type<{ name: string; url: string; key: string }[]>()
    .default([]),
  order: integer('order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const tuitions = pgTable('tuitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  classId: uuid('class_id')
    .notNull()
    .references(() => classes.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  dueDate: timestamp('due_date'),
  paidDate: timestamp('paid_date'),
  status: tuitionStatusEnum('status').default('UNPAID'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const studentScores = pgTable('student_scores', {
  id: uuid('id').defaultRandom().primaryKey(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  classId: uuid('class_id')
    .notNull()
    .references(() => classes.id, { onDelete: 'cascade' }),
  score: numeric('score', { precision: 5, scale: 2 }),
  comment: text('comment'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: aiMessageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ai_messages_user_id_created_at_idx').on(table.userId, table.createdAt)],
);

export const attendances = pgTable(
  'attendances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    present: boolean('present').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('attendances_session_student_unique').on(table.sessionId, table.studentId),
  ],
);

export const exercise = pgTable('exercises', {
  id: uuid('id').defaultRandom().primaryKey(),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  tutorId: uuid('tutor_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  issueUrls: jsonb('issue_urls').$type<{ name: string; url: string; key: string }[]>().default([]),
  exerciseUrls: jsonb('exercise_urls')
    .$type<{ name: string; url: string; key: string }[]>()
    .default([]),
  status: exerciseStatusEnum('status').default('SUBMITTED').notNull(),
  score: numeric('score', { precision: 5, scale: 2 }),
  comment: text('comment'),
  gradedAt: timestamp('graded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: conversationTypeEnum('type').notNull().default('DIRECT'),
  name: varchar('name', { length: 255 }),
  classId: uuid('class_id').references(() => classes.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastMessageAt: timestamp('last_message_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at'),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('conversation_participants_unique').on(table.conversationId, table.userId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    status: messageStatusEnum('status').default('SENT').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('messages_conversation_id_created_at_idx').on(table.conversationId, table.createdAt),
  ],
);

// ─── THIRD_SERVICE: notifications, request_logs ─────────────────────
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, {
    onDelete: 'cascade',
  }),
  senderId: uuid('sender_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  classId: uuid('class_id').references(() => classes.id, {
    onDelete: 'cascade',
  }),
  studentId: uuid('student_id').references(() => users.id, {
    onDelete: 'cascade',
  }),

  type: notificationTypeEnum('type').notNull(),

  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  subContent: varchar('sub_content', {
    length: 255,
  }),
  redirectUrl: varchar('redirect_url', {
    length: 500,
  }),
  actionLabel: varchar('action_label', {
    length: 100,
  }).default('Xem chi tiết'),

  actionType: notificationActionEnum('action_type'),
  isRead: boolean('is_read').default(false).notNull(),
  readAt: timestamp('read_at'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Centralized log of every HTTP request (gateway) and RPC hop (user/tutor-service/
// third-service), written fire-and-forget by each service's LoggerInterceptor /
// TraceContextInterceptor so requests can be traced across all microservices from one table.
export const requestLogs = pgTable(
  'request_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceName: varchar('service_name', { length: 50 }).notNull(),
    type: logTypeEnum('type').notNull(),
    method: varchar('method', { length: 10 }),
    path: text('path').notNull(),
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms').notNull(),
    correlationId: varchar('correlation_id', { length: 100 }).notNull(),
    traceId: varchar('trace_id', { length: 100 }).notNull(),
    parentTraceId: varchar('parent_trace_id', { length: 100 }),
    userId: uuid('user_id'),
    ip: varchar('ip', { length: 64 }),
    requestBody: text('request_body'),
    responseBody: text('response_body'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('request_logs_correlation_id_idx').on(table.correlationId),
    index('request_logs_service_name_created_at_idx').on(table.serviceName, table.createdAt),
  ],
);

// Admin-managed test cases per gateway endpoint ("Kịch bản test"). The request is fired for real
// against the gateway, so it also lands in `request_logs` like any other traffic.
export const testScenarios = pgTable(
  'test_scenarios',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    service: varchar('service', { length: 50 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    path: text('path').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    // { headers?: Record<string,string>, body?: unknown } — header values may use `{{accessToken}}`.
    requestTemplate: jsonb('request_template').$type<Record<string, unknown>>().notNull().default({}),
    expectedStatus: integer('expected_status').notNull(),
    category: testScenarioCategoryEnum('category').notNull().default('valid'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('test_scenarios_method_path_idx').on(table.method, table.path)],
);

// One row per execution of a scenario; joins to `request_logs` through `correlationId`.
export const testRuns = pgTable(
  'test_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => testScenarios.id, { onDelete: 'cascade' }),
    correlationId: varchar('correlation_id', { length: 100 }).notNull(),
    actualStatus: integer('actual_status'),
    expectedStatus: integer('expected_status').notNull(),
    passed: boolean('passed').notNull(),
    durationMs: integer('duration_ms').notNull(),
    errorMessage: text('error_message'),
    triggeredBy: uuid('triggered_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('test_runs_scenario_id_created_at_idx').on(table.scenarioId, table.createdAt),
    index('test_runs_correlation_id_idx').on(table.correlationId),
  ],
);
