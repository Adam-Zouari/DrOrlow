-- SQLite storage is independent of existing MySQL users and submission tables.
-- Creating the table is idempotent and never removes existing records.
CREATE TABLE IF NOT EXISTS form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  gender TEXT,
  email TEXT NOT NULL,
  pemail TEXT,
  birthday TEXT,
  details TEXT,
  interests TEXT,
  join_reason TEXT NOT NULL,
  rating TEXT,
  sports INTEGER NOT NULL DEFAULT 0 CHECK (sports IN (0, 1)),
  science INTEGER NOT NULL DEFAULT 0 CHECK (science IN (0, 1)),
  arts INTEGER NOT NULL DEFAULT 0 CHECK (arts IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
