/**
 * DB module barrel.
 *
 * In the main process, initialise the DB like this:
 *   import { openDatabase, runMigrations, meetingRepo } from './db'
 *   const db = openDatabase(app.getPath('userData') + '/livetranscriber.db')
 *   runMigrations(db)
 */
export { openDatabase, closeDatabase } from './database'
export { runMigrations } from './migrate'
export { meetingRepo } from './repos/meetingRepo'
export { agendaItemRepo } from './repos/agendaItemRepo'
export { participantRepo } from './repos/participantRepo'
export { decisionRepo } from './repos/decisionRepo'
export { actionRepo } from './repos/actionRepo'
export { transcriptSpanRepo } from './repos/transcriptSpanRepo'
export { discussionSummaryRepo } from './repos/discussionSummaryRepo'
