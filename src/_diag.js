// Intentionally empty.
//
// clasp push is ADD-ONLY: it cannot delete a file from the Apps Script project,
// so removing this file locally leaves the old copy live in the cloud. A prior
// version defined doPost() as a temporary OCR probe, which on an
// ANYONE_ANONYMOUS web app let anyone POST bytes and consume the Drive OCR
// quota. Emptying the file is what actually removes that endpoint.
//
// Do not delete this file — it must stay (empty) to keep the cloud copy empty.
