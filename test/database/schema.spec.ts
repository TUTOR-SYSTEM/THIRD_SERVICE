import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  attendances,
  conversationParticipants,
  messages,
  requestLogs,
  testRuns,
} from 'src/database/schema';

/** Index names declared in each table's extra-config callback. */
const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).indexes.map((i) => i.config.name);

describe('schema indexes', () => {
  it('declares the unique session/student index on attendances', () => {
    expect(indexNames(attendances)).toEqual(['attendances_session_student_unique']);
  });

  it('declares the unique participant index on conversation_participants', () => {
    expect(indexNames(conversationParticipants)).toEqual(['conversation_participants_unique']);
  });

  it('declares the conversation timeline index on messages', () => {
    expect(indexNames(messages)).toEqual(['messages_conversation_id_created_at_idx']);
  });

  it('declares the correlation and service timeline indexes on request_logs', () => {
    expect(indexNames(requestLogs)).toEqual([
      'request_logs_correlation_id_idx',
      'request_logs_service_name_created_at_idx',
    ]);
  });

  it('declares the scenario history and correlation indexes on test_runs', () => {
    expect(indexNames(testRuns)).toEqual([
      'test_runs_scenario_id_created_at_idx',
      'test_runs_correlation_id_idx',
    ]);
  });
});
