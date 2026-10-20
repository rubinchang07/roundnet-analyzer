-- =============================================================================
-- Roundnet Tournament Analytics Database: schema
-- Target: PostgreSQL 14+ (tested on 16)
--
-- Layers
--   1. People and teams      player, player_external_id, team
--   2. Competition structure tournament, division, entry
--   3. Results               match, game
--   4. Play-by-play          point, serve_attempt, rally_event
--   5. Ingestion             import_batch (+ loader in import_analyzer.sql)
--   6. Analytics foundations v_match_result, v_player_match, v_point_detail
--
-- Results-only data (public tournament brackets) fills layers 1-3.
-- Roundnet Analyzer exports add layer 4 for the matches it recorded.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS roundnet;
SET search_path = roundnet, public;

-- -----------------------------------------------------------------------------
-- Enumerated types
-- -----------------------------------------------------------------------------
CREATE TYPE match_context AS ENUM ('tournament', 'league', 'scrimmage', 'practice');
-- 'partial': only some rallies were recorded (e.g. tagged clips), so there is
-- no final result. Partial matches feed serve/point stats, not win rates.
CREATE TYPE match_status  AS ENUM ('scheduled', 'completed', 'forfeit', 'retired', 'cancelled', 'partial');
CREATE TYPE match_stage   AS ENUM ('pool', 'bracket', 'placement');

-- How a rally ended, from the point of view of the team that LOST the point
-- for errors, or the team that WON it for winners.
CREATE TYPE point_end_reason AS ENUM (
    'ace',             -- serve not returned by receiver
    'double_fault',    -- both serve attempts faulted
    'hit_winner',      -- attacking hit the defense could not return
    'hitting_error',   -- attacker hit into net/rim/out
    'defense_error',   -- defender touched but could not keep the ball alive
    'receive_error',   -- receiver touched the serve but lost it
    'set_error',       -- bad set / third-touch violation
    'violation',       -- hinder, 4 touches, etc.
    'other'
);

CREATE TYPE serve_result AS ENUM ('in', 'fault');
-- Service faults. The values after 'miss' follow IRF rules 4.5 (July 2026):
-- double_rim 4.5.11, short_toss 4.5.1, same_hand 4.5.14, dropped_toss 4.5.12,
-- three_seconds 4.5.13. 'foot' is any foot fault (4.5.2, 4.5.4-4.5.5),
-- 'miss' 4.5.10.
CREATE TYPE serve_fault  AS ENUM ('high', 'low', 'net', 'rim', 'pocket', 'short', 'long_high', 'foot', 'miss',
                                  'double_rim', 'short_toss', 'same_hand', 'dropped_toss',
                                  'three_seconds', 'other');

-- Which infraction ended a 'violation' point (IRF rules chapters 5 and 6).
CREATE TYPE point_violation AS ENUM (
    'under_three_touches',  -- 5.5.1.7 serve returned in fewer than three touches
    'catch',                -- 5.4.2
    'no_hit_zone',          -- 5.6.2 final hit made in or into the No Hit Zone
    'hit_own_team',         -- 5.5.5.2
    'cylinder',             -- 6.2.2.1
    'hinder',               -- 6.6 hinder awarded as a point
    'simultaneous_contact', -- 5.5.4.1 ball played while still on the net
    'other'
);

CREATE TYPE rally_event_type AS ENUM (
    'serve', 'receive', 'set', 'far_set', 'hit', 'defense', 'touch', 'error', 'replay'
);

CREATE TYPE import_status AS ENUM ('received', 'loaded', 'rejected', 'superseded');

-- -----------------------------------------------------------------------------
-- 1. People and teams
-- -----------------------------------------------------------------------------
CREATE TABLE player (
    player_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name  text NOT NULL,
    first_name    text,
    last_name     text,
    country_code  char(2),            -- ISO 3166-1 alpha-2
    home_region   text,
    dominant_hand char(1) CHECK (dominant_hand IN ('L', 'R')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Maps identifiers from outside sources (Analyzer roster ids, results sites)
-- onto one canonical player, so re-imports never duplicate people.
CREATE TABLE player_external_id (
    source       text   NOT NULL,     -- 'analyzer', 'fwango', 'manual', ...
    external_id  text   NOT NULL,
    player_id    bigint NOT NULL REFERENCES player ON DELETE CASCADE,
    PRIMARY KEY (source, external_id)
);
CREATE INDEX ON player_external_id (player_id);

-- A team is an unordered pair of players (a partnership). Storing the pair in
-- canonical order (lower id first) makes each partnership exactly one row,
-- which is what partner-combination analytics group on.
-- Per-event team names live on entry, because names change between events.
CREATE TABLE team (
    team_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_lo_id bigint NOT NULL REFERENCES player,
    player_hi_id bigint NOT NULL REFERENCES player,
    CONSTRAINT team_canonical_order CHECK (player_lo_id < player_hi_id),
    CONSTRAINT team_pair_unique UNIQUE (player_lo_id, player_hi_id)
);
CREATE INDEX ON team (player_hi_id);   -- lo is covered by the unique index

-- One row per (team, player); makes "all teams of player X" a simple join.
CREATE VIEW team_member AS
SELECT team_id, player_lo_id AS player_id, player_hi_id AS partner_id FROM team
UNION ALL
SELECT team_id, player_hi_id, player_lo_id FROM team;

-- Helper used by loaders: find or create the canonical team for two players.
CREATE FUNCTION team_for(p1 bigint, p2 bigint) RETURNS bigint
LANGUAGE plpgsql SET search_path = roundnet, public AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p1 = p2 THEN
        RAISE EXCEPTION 'a team needs two different players (got % twice)', p1;
    END IF;
    INSERT INTO team (player_lo_id, player_hi_id)
    VALUES (LEAST(p1, p2), GREATEST(p1, p2))
    ON CONFLICT ON CONSTRAINT team_pair_unique DO NOTHING
    RETURNING team_id INTO v_id;
    IF v_id IS NULL THEN
        SELECT team_id INTO v_id FROM team
        WHERE player_lo_id = LEAST(p1, p2) AND player_hi_id = GREATEST(p1, p2);
    END IF;
    RETURN v_id;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Competition structure
-- -----------------------------------------------------------------------------
CREATE TABLE tournament (
    tournament_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          text NOT NULL,
    series        text,               -- tour or circuit, if any
    tier          text,               -- e.g. 'major', 'challenger', 'local'
    start_date    date NOT NULL,
    end_date      date NOT NULL,
    city          text,
    region        text,
    country_code  char(2),
    source        text,
    source_ref    text,
    CONSTRAINT tournament_dates CHECK (end_date >= start_date),
    CONSTRAINT tournament_natural_key UNIQUE (name, start_date)
);

-- A bracket within a tournament (Men's Premier, Mixed Contender, ...).
CREATE TABLE division (
    division_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tournament_id bigint NOT NULL REFERENCES tournament ON DELETE CASCADE,
    name          text NOT NULL,
    category      text CHECK (category IN ('open', 'men', 'women', 'mixed', 'junior', 'other')),
    skill_level   text,               -- 'premier', 'contender', 'intermediate', ...
    team_count    int  CHECK (team_count > 0),
    UNIQUE (tournament_id, name)
);

-- A team's registration in a division. Holds what is specific to that event:
-- the team name they played under, seed and final placement.
CREATE TABLE entry (
    entry_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    division_id   bigint NOT NULL REFERENCES division ON DELETE CASCADE,
    team_id       bigint NOT NULL REFERENCES team,
    team_name     text,
    seed          int CHECK (seed > 0),
    final_place   int CHECK (final_place > 0),   -- 1 = champion; ties allowed (e.g. 5th)
    UNIQUE (division_id, team_id)
);
CREATE INDEX ON entry (team_id);

-- -----------------------------------------------------------------------------
-- 3. Results
-- -----------------------------------------------------------------------------
-- Sides are numbered 1 and 2; winner_side and every per-side column below
-- refer to those numbers, so results can never point at a third team.
CREATE TABLE match (
    match_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    context         match_context NOT NULL DEFAULT 'tournament',
    division_id     bigint REFERENCES division ON DELETE CASCADE,
    stage           match_stage,
    round_label     text,             -- 'Pool A R2', 'QF', 'SF', 'F', ...
    bracket_order   int,              -- ordering within the stage, for display
    team1_id        bigint NOT NULL REFERENCES team,
    team2_id        bigint NOT NULL REFERENCES team,
    played_at       timestamptz,      -- start time; date precision is fine for brackets
    best_of         smallint NOT NULL DEFAULT 1 CHECK (best_of IN (1, 3, 5)),
    status          match_status NOT NULL DEFAULT 'completed',
    winner_side     smallint CHECK (winner_side IN (1, 2)),
    source          text NOT NULL DEFAULT 'manual',
    external_id     text,
    import_batch_id bigint,           -- FK added after import_batch is created
    has_point_data  boolean NOT NULL DEFAULT false,
    CONSTRAINT match_distinct_teams CHECK (team1_id <> team2_id),
    CONSTRAINT match_tournament_has_division
        CHECK (context <> 'tournament' OR division_id IS NOT NULL),
    CONSTRAINT match_result_present
        CHECK (status NOT IN ('completed', 'forfeit', 'retired') OR winner_side IS NOT NULL),
    CONSTRAINT match_external_unique UNIQUE (source, external_id),
    -- Both teams must be registered in the division. MATCH SIMPLE semantics skip
    -- the check automatically when division_id is NULL (scrimmage/practice).
    CONSTRAINT match_team1_entered FOREIGN KEY (division_id, team1_id)
        REFERENCES entry (division_id, team_id),
    CONSTRAINT match_team2_entered FOREIGN KEY (division_id, team2_id)
        REFERENCES entry (division_id, team_id)
);
CREATE INDEX ON match (division_id);
CREATE INDEX ON match (team1_id);
CREATE INDEX ON match (team2_id);
CREATE INDEX ON match (played_at);

-- The two teams in a match may not share a player.
CREATE FUNCTION trg_match_no_shared_player() RETURNS trigger
LANGUAGE plpgsql SET search_path = roundnet, public AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM team_member a JOIN team_member b USING (player_id)
        WHERE a.team_id = NEW.team1_id AND b.team_id = NEW.team2_id
    ) THEN
        RAISE EXCEPTION 'match %: teams % and % share a player',
            NEW.match_id, NEW.team1_id, NEW.team2_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER match_no_shared_player
    BEFORE INSERT OR UPDATE OF team1_id, team2_id ON match
    FOR EACH ROW EXECUTE FUNCTION trg_match_no_shared_player();

-- One row per game (set). Scores are stored even when point data exists,
-- because most public results only publish game scores. complete = false marks
-- a game where only some rallies were recorded; its score is then just the
-- tally of recorded points and it has no winner.
CREATE TABLE game (
    game_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    match_id    bigint   NOT NULL REFERENCES match ON DELETE CASCADE,
    game_number smallint NOT NULL CHECK (game_number BETWEEN 1 AND 5),
    points_to   smallint NOT NULL DEFAULT 21 CHECK (points_to > 0),
    hard_cap    smallint,             -- IRF 3.4.2: tied at hard_cap - 1, the next point wins
    team1_score smallint NOT NULL CHECK (team1_score >= 0),
    team2_score smallint NOT NULL CHECK (team2_score >= 0),
    complete    boolean  NOT NULL DEFAULT true,
    import_batch_id bigint,           -- file this game came from; FK added below
    winner_side smallint GENERATED ALWAYS AS
        (CASE WHEN NOT complete THEN NULL
              WHEN team1_score > team2_score THEN 1
              WHEN team2_score > team1_score THEN 2 END) STORED,
    CONSTRAINT game_not_tied CHECK (NOT complete OR team1_score <> team2_score),
    CONSTRAINT game_hard_cap_above_target CHECK (hard_cap IS NULL OR hard_cap > points_to),
    UNIQUE (match_id, game_number)
);

-- -----------------------------------------------------------------------------
-- 4. Play-by-play (from Roundnet Analyzer exports)
-- -----------------------------------------------------------------------------
-- One row per rally. The running score is not stored: it is derived with a
-- window function in v_point_detail, so it can never drift from the rows.
CREATE TABLE point (
    point_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    game_id            bigint   NOT NULL REFERENCES game ON DELETE CASCADE,
    point_number       smallint NOT NULL CHECK (point_number > 0),
    external_id        text UNIQUE,       -- source's own point id (Analyzer UUID)
    serving_side       smallint NOT NULL CHECK (serving_side IN (1, 2)),
    server_player_id   bigint   NOT NULL REFERENCES player,
    receiver_player_id bigint   REFERENCES player,     -- NULL when the source doesn't record it
    winner_side        smallint NOT NULL CHECK (winner_side IN (1, 2)),
    end_reason         point_end_reason,
    violation_type     point_violation,    -- set only when end_reason = 'violation'
    source_outcome     text,               -- outcome label exactly as the source wrote it
    ended_by_player_id bigint REFERENCES player,  -- who hit the winner or made the error
    possessions        smallint CHECK (possessions >= 0),  -- 0 = ace / double fault
    video_start_s      numeric(10, 3),  -- seconds into the source video
    video_end_s        numeric(10, 3),
    CONSTRAINT point_video_order CHECK (video_end_s IS NULL OR video_end_s >= video_start_s),
    -- Serve-only endings must agree with who won.
    CONSTRAINT point_violation_type_only_on_violation
        CHECK (violation_type IS NULL OR end_reason = 'violation'),
    CONSTRAINT point_ace_consistent
        CHECK (end_reason <> 'ace' OR winner_side = serving_side),
    CONSTRAINT point_double_fault_consistent
        CHECK (end_reason <> 'double_fault' OR winner_side <> serving_side),
    UNIQUE (game_id, point_number)
);
CREATE INDEX ON point (server_player_id);
CREATE INDEX ON point (receiver_player_id);

-- The server must be on the serving side and the receiver on the other side.
CREATE FUNCTION trg_point_players_valid() RETURNS trigger
LANGUAGE plpgsql SET search_path = roundnet, public AS $$
DECLARE
    v_serving_team   bigint;
    v_receiving_team bigint;
BEGIN
    SELECT CASE NEW.serving_side WHEN 1 THEN m.team1_id ELSE m.team2_id END,
           CASE NEW.serving_side WHEN 1 THEN m.team2_id ELSE m.team1_id END
      INTO v_serving_team, v_receiving_team
      FROM game g JOIN match m USING (match_id)
     WHERE g.game_id = NEW.game_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'point %: game % does not exist', NEW.point_number, NEW.game_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM team_member
                   WHERE team_id = v_serving_team AND player_id = NEW.server_player_id) THEN
        RAISE EXCEPTION 'point %/%: server % is not on serving side %',
            NEW.game_id, NEW.point_number, NEW.server_player_id, NEW.serving_side;
    END IF;
    IF NEW.receiver_player_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM team_member
            WHERE team_id = v_receiving_team AND player_id = NEW.receiver_player_id) THEN
        RAISE EXCEPTION 'point %/%: receiver % is not on the receiving side',
            NEW.game_id, NEW.point_number, NEW.receiver_player_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER point_players_valid
    BEFORE INSERT OR UPDATE OF game_id, serving_side, server_player_id, receiver_player_id
    ON point FOR EACH ROW EXECUTE FUNCTION trg_point_players_valid();

-- Each point has one or two serve attempts (one fault is allowed).
CREATE TABLE serve_attempt (
    point_id       bigint   NOT NULL REFERENCES point ON DELETE CASCADE,
    attempt_number smallint NOT NULL CHECK (attempt_number IN (1, 2)),
    external_id    text UNIQUE,       -- source's own serve id (Analyzer UUID)
    result         serve_result NOT NULL,
    fault_type     serve_fault,
    played_through boolean,           -- receiver played a faulted serve, so the rally went on
    hand           char(1) CHECK (hand IN ('L', 'R')),   -- hand used on this serve
    serve_style    text,              -- 'reverse', 'cut', 'tap-on', 'drop', 'power', ...
    speed_kph      numeric(5, 1) CHECK (speed_kph > 0),
    video_s        numeric(10, 3),
    PRIMARY KEY (point_id, attempt_number),
    CONSTRAINT serve_fault_type_only_on_fault
        CHECK (result = 'fault' OR fault_type IS NULL),
    CONSTRAINT serve_played_through_only_on_fault
        CHECK (result = 'fault' OR played_through IS NULL)
);

-- Touch-by-touch event history inside a rally, in order. Optional: the
-- Analyzer may export only point-level data.
CREATE TABLE rally_event (
    point_id    bigint   NOT NULL REFERENCES point ON DELETE CASCADE,
    seq         smallint NOT NULL CHECK (seq > 0),
    external_id text UNIQUE,         -- source's own touch id (Analyzer UUID)
    event_type  rally_event_type NOT NULL,
    player_id   bigint REFERENCES player,
    side        smallint CHECK (side IN (1, 2)),
    video_s     numeric(10, 3),
    detail      jsonb,               -- anything extra the tracker emits (shot type, zone, ...)
    PRIMARY KEY (point_id, seq)
);
CREATE INDEX ON rally_event (player_id);

-- -----------------------------------------------------------------------------
-- 5. Ingestion
-- -----------------------------------------------------------------------------
-- Every import file is kept verbatim. Hashing the file makes re-imports
-- idempotent, and the raw payload lets the loader be re-run after a fix.
CREATE TABLE import_batch (
    import_batch_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source          text NOT NULL,           -- 'analyzer', 'results_csv', ...
    format_version  text NOT NULL,
    file_name       text,
    file_sha256     text NOT NULL UNIQUE,
    payload         jsonb NOT NULL,
    status          import_status NOT NULL DEFAULT 'received',
    error           text,
    warnings        jsonb,                   -- soft data issues the loader noticed but accepted
    received_at     timestamptz NOT NULL DEFAULT now(),
    loaded_at       timestamptz
);

ALTER TABLE match
    ADD CONSTRAINT match_import_batch_fk
    FOREIGN KEY (import_batch_id) REFERENCES import_batch ON DELETE SET NULL;
CREATE INDEX ON match (import_batch_id);
ALTER TABLE game
    ADD CONSTRAINT game_import_batch_fk
    FOREIGN KEY (import_batch_id) REFERENCES import_batch ON DELETE SET NULL;
CREATE INDEX ON game (import_batch_id);

-- -----------------------------------------------------------------------------
-- 6. Analytics foundations
-- -----------------------------------------------------------------------------
-- Match with tournament context and game totals.
CREATE VIEW v_match_result AS
SELECT m.match_id,
       m.context,
       t.tournament_id,
       t.name                                    AS tournament_name,
       d.division_id,
       d.name                                    AS division_name,
       m.stage,
       m.round_label,
       COALESCE(m.played_at, t.start_date::timestamptz) AS played_at,
       m.team1_id,
       m.team2_id,
       m.status,
       m.winner_side,
       CASE m.winner_side WHEN 1 THEN m.team1_id WHEN 2 THEN m.team2_id END AS winner_team_id,
       CASE m.winner_side WHEN 1 THEN m.team2_id WHEN 2 THEN m.team1_id END AS loser_team_id,
       COUNT(g.game_id) FILTER (WHERE g.winner_side = 1)  AS team1_games,
       COUNT(g.game_id) FILTER (WHERE g.winner_side = 2)  AS team2_games,
       COALESCE(SUM(g.team1_score), 0)                    AS team1_points,
       COALESCE(SUM(g.team2_score), 0)                    AS team2_points,
       m.has_point_data
FROM match m
LEFT JOIN division   d USING (division_id)
LEFT JOIN tournament t USING (tournament_id)
LEFT JOIN game       g USING (match_id)
GROUP BY m.match_id, t.tournament_id, d.division_id;

-- One row per player per match: the shape almost every player metric starts
-- from (win rate, head-to-head, partner combos, rolling form).
CREATE VIEW v_player_match AS
WITH sides AS (
    SELECT r.*, 1 AS side, r.team1_id AS team_id, r.team2_id AS opp_team_id,
           r.team1_games AS games_won, r.team2_games AS games_lost,
           r.team1_points AS points_won, r.team2_points AS points_lost
    FROM v_match_result r
    UNION ALL
    SELECT r.*, 2, r.team2_id, r.team1_id,
           r.team2_games, r.team1_games, r.team2_points, r.team1_points
    FROM v_match_result r
)
SELECT s.match_id,
       s.played_at,
       s.context,
       s.tournament_id,
       s.division_id,
       s.stage,
       s.round_label,
       tm.player_id,
       tm.partner_id,
       s.team_id,
       s.opp_team_id,
       o.player_lo_id AS opp1_player_id,
       o.player_hi_id AS opp2_player_id,
       s.side,
       (s.winner_side = s.side) AS won,
       s.games_won, s.games_lost,
       s.points_won, s.points_lost
FROM sides s
JOIN team_member tm ON tm.team_id = s.team_id
JOIN team        o  ON o.team_id  = s.opp_team_id
WHERE s.status IN ('completed', 'forfeit', 'retired');

-- Point with running score before it was played, and hold/break flag.
CREATE VIEW v_point_detail AS
SELECT p.*,
       g.match_id,
       g.game_number,
       COALESCE(SUM((p.winner_side = 1)::int) OVER w, 0) AS team1_score_before,
       COALESCE(SUM((p.winner_side = 2)::int) OVER w, 0) AS team2_score_before,
       (p.winner_side = p.serving_side)                   AS serving_team_won,  -- hold
       (SELECT COUNT(*) FROM serve_attempt sa
         WHERE sa.point_id = p.point_id)                  AS serve_attempts
FROM point p
JOIN game g USING (game_id)
WINDOW w AS (PARTITION BY p.game_id ORDER BY p.point_number
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING);
