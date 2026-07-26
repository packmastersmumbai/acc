// Intentionally empty.
//
// clasp push is ADD-ONLY: it cannot delete a file from the Apps Script project,
// so removing this file locally leaves the old copy live in the cloud. Prior
// versions defined doPost()/diagnostic doGet routes here; on an
// ANYONE_ANONYMOUS web app those were reachable by anyone. Emptying the file is
// what actually removes them.
//
// Do not delete this file — it must stay (empty) to keep the cloud copy empty.
