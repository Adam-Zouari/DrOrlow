-- Run against the database selected by DB_NAME, using a setup account.
-- The runtime account needs INSERT access to form_submissions only.
-- A separate Super Orlow reader account needs SELECT on form_submissions.
-- Existing users and their records are intentionally left untouched.
CREATE TABLE IF NOT EXISTS form_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  surname VARCHAR(80) NOT NULL,
  gender VARCHAR(32) NULL,
  email VARCHAR(254) NOT NULL,
  pemail VARCHAR(254) NULL,
  birthday DATE NULL,
  details TEXT NULL,
  interests TEXT NULL,
  join_reason TEXT NOT NULL,
  rating VARCHAR(16) NULL,
  sports BOOLEAN NOT NULL DEFAULT FALSE,
  science BOOLEAN NOT NULL DEFAULT FALSE,
  arts BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
