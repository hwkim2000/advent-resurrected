-- D1 gate for the AI parse endpoint (spec: ai-parser, design "d1-gate-store.ts").
-- hits:  sliding-window log, one row per request counted against a salted IP key.
-- daily: one counter row per UTC day (the Daily_Cap).
-- Apply locally with: npm run db:local   (remote application is an owner step).

CREATE TABLE IF NOT EXISTS hits (
  k TEXT NOT NULL,
  t INTEGER NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (k, t, id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS daily (
  day TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  last_id TEXT
) WITHOUT ROWID;
