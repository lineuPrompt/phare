// ---------------------------------------------------------------------------
// The suite-wide stand-in for src/lib/eventWriter.ts (installed by
// vitest.setup.ts). Every event a test causes is recorded here, whichever
// route or helper wrote it, so a test asserts on the rows that would have
// reached the database through the service role.
//
// Reset before every test (vitest.setup.ts). A test may make the next insert
// fail or throw to drive an error path.
// ---------------------------------------------------------------------------

export type RecordedEvent = {
  household_id?: unknown;
  user_id?: unknown;
  event_type?: unknown;
  metadata?: unknown;
};

/** Rows inserted into `events` in this test, in order. */
export const recordedEvents: RecordedEvent[] = [];

export const eventWriterBehaviour: {
  /** Returned as the insert's `{ error }`. */
  insertError: { message: string } | null;
  /** Makes the insert reject, as a network failure would. */
  insertThrows: boolean;
} = { insertError: null, insertThrows: false };

export function resetEventWriterDouble(): void {
  recordedEvents.length = 0;
  eventWriterBehaviour.insertError = null;
  eventWriterBehaviour.insertThrows = false;
}

/** What eventWriter() returns in tests: a client that only accepts inserts into `events`. */
export function fakeEventWriter() {
  return {
    from(table: string) {
      if (table !== 'events') throw new Error(`eventWriter is only for events, not ${table}`);
      return {
        insert: async (row: RecordedEvent) => {
          if (eventWriterBehaviour.insertThrows) throw new Error('simulated network failure');
          if (eventWriterBehaviour.insertError) return { error: eventWriterBehaviour.insertError };
          recordedEvents.push(row);
          return { error: null };
        },
      };
    },
  };
}
