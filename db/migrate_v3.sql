-- Upgrades a database built from the earlier ddl.sql so it can load Analyzer
-- formatVersion 3 exports. Run once, then re-run import_analyzer.sql.
-- A fresh database built from the current ddl.sql doesn't need this.
SET search_path = roundnet, public;

ALTER TYPE serve_fault ADD VALUE IF NOT EXISTS 'short_toss'       BEFORE 'other';
ALTER TYPE serve_fault ADD VALUE IF NOT EXISTS 'same_hand'        BEFORE 'other';
ALTER TYPE serve_fault ADD VALUE IF NOT EXISTS 'double_rim'       BEFORE 'other';
ALTER TYPE serve_fault ADD VALUE IF NOT EXISTS 'dropped_toss'     BEFORE 'other';
ALTER TYPE serve_fault ADD VALUE IF NOT EXISTS 'three_seconds'    BEFORE 'other';

DO $$ BEGIN
    CREATE TYPE point_violation AS ENUM (
        'under_three_touches', 'catch', 'no_hit_zone', 'hit_own_team', 'cylinder', 'hinder',
        'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE point_violation ADD VALUE IF NOT EXISTS 'simultaneous_contact' BEFORE 'other';

ALTER TABLE game  ADD COLUMN IF NOT EXISTS hard_cap smallint;
ALTER TABLE point ADD COLUMN IF NOT EXISTS violation_type point_violation;

ALTER TABLE game DROP CONSTRAINT IF EXISTS game_hard_cap_above_target;
ALTER TABLE game ADD CONSTRAINT game_hard_cap_above_target
    CHECK (hard_cap IS NULL OR hard_cap > points_to);
ALTER TABLE point DROP CONSTRAINT IF EXISTS point_violation_type_only_on_violation;
ALTER TABLE point ADD CONSTRAINT point_violation_type_only_on_violation
    CHECK (violation_type IS NULL OR end_reason = 'violation');

-- v1/v2 files stored "Missed Net" as 'other'; it now maps to 'miss'.
UPDATE serve_attempt sa
   SET fault_type = 'miss'
  FROM point p JOIN game g USING (game_id) JOIN import_batch b USING (import_batch_id),
       LATERAL jsonb_array_elements(b.payload->'points') pt,
       LATERAL jsonb_array_elements(pt->'serves') sv
 WHERE sa.point_id = p.point_id AND sa.fault_type = 'other'
   AND sv->>'id' = sa.external_id AND sv->>'faultType' = 'Missed Net';
