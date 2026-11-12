// How the databases of the app write to the disk. With the WAL journal a write is added to the end of a journal file instead of
// rewriting the pages of the database (and reads do not wait for writes); with synchronous NORMAL the disk is only flushed when the
// journal is copied into the database. The database never ends broken: at worst, if the computer itself stops, the last writes are lost.
export const JOURNAL_PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;';
