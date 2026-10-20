-- =============================================================================
-- Loader for Roundnet Analyzer match exports (roundnet-match.json)
-- Requires ddl.sql. See import_format.md for the file layout and mapping.
--
-- Reads both export versions:
--   v1 (no formatVersion): players, teams, points with serves. One file = one game.
--   v2 (formatVersion 2):  adds match {id, playedOn}, serves[].receiverId,
--                          points[].gameNumber and points[].rally (touches).
--   v3 (formatVersion 3):  adds match {pointsTo, hardCap}, points[].violationType,
--                          the full IRF list of fault types, and the Defensive
--                          Error, Receive Error and Violation outcomes.
--                          Later v3 files can also mark serves replayed
--                          (serves[].replayed, replayReason); those are
--                          stored as 'replay' rally events, not attempts.
-- Context the export doesn't carry (tournament, round, ...) comes from the
-- optional third argument; its values override the file's:
--
--   SELECT roundnet.import_analyzer_export(
--       pg_read_file('/path/roundnet-match.json')::jsonb,
--       'roundnet-match.json',
--       '{"match_key": "fall-classic-qf", "context": "tournament",
--         "tournament": {"name": "Garden State Fall Classic", "start_date": "2026-09-19"},
--         "division": {"name": "Men''s Contender"}, "round": "QF", "best_of": 3,
--         "game_number": 1, "game_complete": true}'::jsonb);
--
--   From psql:  \set content `cat roundnet-match.json`
--               SELECT roundnet.import_analyzer_export(:'content'::jsonb, 'roundnet-match.json');
--
-- Behaviour
--   * Returns the match_id, or NULL if the file was rejected. A rejected file is
--     kept in import_batch with status 'rejected' and the error; nothing else
--     from it is written.
--   * The same file (and match info) loads once; a repeat call is a no-op.
--   * Points and serves keep the Analyzer's UUIDs. A later export containing any
--     of the same point ids is a re-export: it replaces the game those points
--     were in, and the earlier file is marked 'superseded'.
--   * Points are split into games by gameNumber (v2) or loaded as one game
--     (v1, game_number from match info). Files that share a match key (v2
--     match.id, or match_key in match info) build up one match.
--   * A game whose tagged points form a finished score (reaches points_to,
--     2 clear, or reaches hard_cap) is complete; otherwise it is stored as
--     partial.
--   * Soft data issues (out-of-order timestamps, an unknown outcome label, ...)
--     don't block the load. They are listed in import_batch.warnings.
-- =============================================================================
SET search_path = roundnet, public;

DROP FUNCTION IF EXISTS import_analyzer_export(jsonb, text);
DROP FUNCTION IF EXISTS import_analyzer_export(jsonb, text, jsonb);
DROP FUNCTION IF EXISTS resolve_analyzer_player(jsonb);
DROP FUNCTION IF EXISTS resolve_analyzer_player(text);

-- Find or create a player by Analyzer name. The export's ids ("player-1") are
-- slot numbers that are reused in every match, so the name is the identity
-- key. Pass match info "player_ids" to pin a slot to a known player instead.
CREATE OR REPLACE FUNCTION resolve_analyzer_player(p_name text) RETURNS bigint
LANGUAGE plpgsql SET search_path = roundnet, public AS $$
DECLARE
    v_key text := lower(btrim(p_name));
    v_id  bigint;
BEGIN
    IF v_key IS NULL OR v_key = '' THEN
        RAISE EXCEPTION 'player with an empty name';
    END IF;
    SELECT player_id INTO v_id
      FROM player_external_id WHERE source = 'analyzer' AND external_id = v_key;
    IF v_id IS NULL THEN
        INSERT INTO player (display_name) VALUES (btrim(p_name))
        RETURNING player_id INTO v_id;
        INSERT INTO player_external_id (source, external_id, player_id)
        VALUES ('analyzer', v_key, v_id);
    END IF;
    RETURN v_id;
END $$;

-- Analyzer fault label -> serve_fault. Unknown labels map to 'other'.
CREATE OR REPLACE FUNCTION analyzer_fault_type(p_label text) RETURNS serve_fault
LANGUAGE sql IMMUTABLE SET search_path = roundnet, public AS $$
    SELECT CASE lower(btrim(p_label))
        WHEN 'high'             THEN 'high'
        WHEN 'rim'              THEN 'rim'
        WHEN 'pocket'           THEN 'pocket'
        WHEN 'missed net'       THEN 'miss'
        WHEN 'short toss'       THEN 'short_toss'
        WHEN 'same hand'        THEN 'same_hand'
        WHEN 'foot on line'     THEN 'foot'
        WHEN 'double rim'       THEN 'double_rim'
        WHEN 'dropped toss'     THEN 'dropped_toss'
        WHEN 'three seconds'    THEN 'three_seconds'
        ELSE 'other'
    END::serve_fault
$$;

-- Analyzer violation label -> point_violation. Unknown labels map to 'other'.
CREATE OR REPLACE FUNCTION analyzer_violation_type(p_label text) RETURNS point_violation
LANGUAGE sql IMMUTABLE SET search_path = roundnet, public AS $$
    SELECT CASE lower(btrim(p_label))
        WHEN 'under three touches' THEN 'under_three_touches'
        WHEN 'catch'               THEN 'catch'
        WHEN 'no hit zone'         THEN 'no_hit_zone'
        WHEN 'hit own team'        THEN 'hit_own_team'
        WHEN 'cylinder'            THEN 'cylinder'
        WHEN 'hinder'              THEN 'hinder'
        WHEN 'simultaneous contact' THEN 'simultaneous_contact'
        ELSE 'other'
    END::point_violation
$$;

-- Analyzer outcome label -> point_end_reason. Unknown labels map to 'other';
-- the original label is always kept in point.source_outcome.
CREATE OR REPLACE FUNCTION analyzer_end_reason(p_outcome text) RETURNS point_end_reason
LANGUAGE sql IMMUTABLE SET search_path = roundnet, public AS $$
    SELECT CASE lower(btrim(p_outcome))
        WHEN 'ace'             THEN 'ace'
        WHEN 'double fault'    THEN 'double_fault'
        WHEN 'kill'            THEN 'hit_winner'
        WHEN 'offensive error' THEN 'hitting_error'
        WHEN 'defensive error' THEN 'defense_error'
        WHEN 'receive error'   THEN 'receive_error'
        WHEN 'receiving error' THEN 'receive_error'
        WHEN 'set error'       THEN 'set_error'
        WHEN 'violation'       THEN 'violation'
        ELSE 'other'
    END::point_end_reason
$$;

CREATE FUNCTION import_analyzer_export(
    p_payload   jsonb,
    p_file_name text  DEFAULT NULL,
    p_match     jsonb DEFAULT '{}'
) RETURNS bigint
LANGUAGE plpgsql SET search_path = roundnet, public AS $$
DECLARE
    v_hash      text := encode(sha256(convert_to(
                            p_payload::text || coalesce(p_match, '{}')::text, 'UTF8')), 'hex');
    v_batch     bigint;
    v_status    import_status;
    v_match_id  bigint;
    v_pmap      jsonb := '{}';     -- Analyzer player id -> player_id
    v_sidemap   jsonb := '{}';     -- Analyzer player id -> side in this file (1/2)
    v_team      bigint[];          -- file side 1/2 -> team_id
    v_flip      boolean := false;  -- file side 1 is the stored match's side 2
    v_tourn     bigint;
    v_div       bigint;
    v_game      bigint;
    v_game_no   smallint := coalesce((p_match->>'game_number')::smallint, 1);
    v_complete  boolean;
    v_gno       smallint;
    v_points_to smallint := coalesce((p_match->>'points_to')::smallint,
                                     (p_payload->'match'->>'pointsTo')::smallint, 21);
    v_hard_cap  smallint := coalesce((p_match->>'hard_cap')::smallint,
                                     (p_payload->'match'->>'hardCap')::smallint);
    v_context   match_context;
    v_key       text;
    v_p         jsonb;
    v_i         int;
    v_t1        int;
    v_t2        int;
    v_g1        int;
    v_g2        int;
    v_best_of   smallint;
    v_warn      jsonb := '[]';
    v_msg       text;
    v_replays   jsonb := '[]';     -- replayed serves, with their point's id
BEGIN
    -- Idempotency: the same file + match info only ever loads once.
    SELECT import_batch_id, status INTO v_batch, v_status
      FROM import_batch WHERE file_sha256 = v_hash;
    IF v_status IN ('loaded', 'superseded') THEN
        SELECT match_id INTO v_match_id FROM game WHERE import_batch_id = v_batch LIMIT 1;
        RETURN v_match_id;
    ELSIF v_batch IS NULL THEN
        INSERT INTO import_batch (source, format_version, file_name, file_sha256, payload)
        VALUES ('analyzer', coalesce(p_payload->>'formatVersion', '1'),
                p_file_name, v_hash,
                jsonb_build_object('export', p_payload, 'match_info', coalesce(p_match, '{}')))
        RETURNING import_batch_id INTO v_batch;
    END IF;

    BEGIN  -- everything below rolls back as a unit if any hard check fails

        ------------------------------------------------------------------
        -- Hard checks: structure the loader cannot work without
        ------------------------------------------------------------------
        IF coalesce(p_payload->>'formatVersion', '1') NOT IN ('1', '2', '3') THEN
            RAISE EXCEPTION 'unsupported Analyzer formatVersion %', p_payload->>'formatVersion';
        END IF;
        IF jsonb_typeof(p_payload->'players') <> 'array'
           OR jsonb_typeof(p_payload->'teams') <> 'array'
           OR jsonb_typeof(p_payload->'points') <> 'array' THEN
            RAISE EXCEPTION 'not an Analyzer match export: players, teams and points arrays are required';
        END IF;
        IF jsonb_array_length(p_payload->'points') = 0 THEN
            RAISE EXCEPTION 'export has no points';
        END IF;
        IF jsonb_array_length(p_payload->'teams') <> 2
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'teams') t
                       WHERE jsonb_array_length(t) <> 2) THEN
            RAISE EXCEPTION 'teams must be two pairs of player ids';
        END IF;

        -- Replays (IRF 3.2.5): a replayed serve is not an attempt. Set the
        -- replayed serves aside (they become 'replay' rally events) and drop
        -- them from the serve lists, so the attempts left are 1 and 2.
        SELECT coalesce(jsonb_agg(jsonb_build_object('point', pt->>'id', 'serve', sv)
                                  ORDER BY p_ord, s_ord), '[]')
          INTO v_replays
          FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, p_ord),
               jsonb_array_elements(coalesce(pt->'serves', '[]')) WITH ORDINALITY s(sv, s_ord)
         WHERE coalesce((sv->>'replayed')::boolean, false);
        IF jsonb_array_length(v_replays) > 0 THEN
            p_payload := jsonb_set(p_payload, '{points}', (
                SELECT jsonb_agg(jsonb_set(pt, '{serves}', coalesce((
                           SELECT jsonb_agg(sv ORDER BY s_ord)
                             FROM jsonb_array_elements(coalesce(pt->'serves', '[]'))
                                  WITH ORDINALITY s(sv, s_ord)
                            WHERE NOT coalesce((sv->>'replayed')::boolean, false)), '[]'))
                       ORDER BY ord)
                  FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, ord)));
            IF jsonb_typeof(p_payload->'serves') = 'array' THEN
                p_payload := jsonb_set(p_payload, '{serves}', coalesce((
                    SELECT jsonb_agg(sv ORDER BY ord)
                      FROM jsonb_array_elements(p_payload->'serves') WITH ORDINALITY s(sv, ord)
                     WHERE NOT coalesce((sv->>'replayed')::boolean, false)), '[]'));
            END IF;
        END IF;

        -- Players: Analyzer id -> canonical player
        FOR v_p IN SELECT * FROM jsonb_array_elements(p_payload->'players') LOOP
            v_pmap := v_pmap || jsonb_build_object(v_p->>'id',
                coalesce((p_match->'player_ids'->>(v_p->>'id'))::bigint,
                         resolve_analyzer_player(v_p->>'name')));
        END LOOP;

        -- Teams: "Team 1" is teams[0], "Team 2" is teams[1]
        FOR v_i IN 0..1 LOOP
            IF (v_pmap->>(p_payload->'teams'->v_i->>0)) IS NULL
               OR (v_pmap->>(p_payload->'teams'->v_i->>1)) IS NULL THEN
                RAISE EXCEPTION 'team % lists a player id that is not in players', v_i + 1;
            END IF;
            v_team[v_i + 1] := team_for((v_pmap->>(p_payload->'teams'->v_i->>0))::bigint,
                                        (v_pmap->>(p_payload->'teams'->v_i->>1))::bigint);
            v_sidemap := v_sidemap
                || jsonb_build_object(p_payload->'teams'->v_i->>0, v_i + 1)
                || jsonb_build_object(p_payload->'teams'->v_i->>1, v_i + 1);
        END LOOP;

        SELECT string_agg(format('point %s: %s', ord, problem), '; ') INTO v_msg
        FROM (
            SELECT ord,
                   CASE
                     WHEN pt->>'id' IS NULL                       THEN 'missing id'
                     WHEN v_sidemap->>(pt->>'serverId') IS NULL   THEN 'serverId is not on either team'
                     WHEN pt->>'winningTeam' NOT IN ('Team 1', 'Team 2')
                                                                  THEN 'winningTeam must be "Team 1" or "Team 2"'
                     WHEN coalesce(jsonb_array_length(pt->'serves'), 0) = 0
                                                                  THEN 'has no serves'
                     WHEN jsonb_array_length(pt->'serves') > 2    THEN 'has more than two serves'
                     WHEN pt ? 'gameNumber'
                      AND (pt->>'gameNumber') !~ '^[1-5]$'         THEN 'gameNumber must be 1 to 5'
                     WHEN pt->>'responsiblePlayerId' IS NOT NULL
                      AND v_pmap->>(pt->>'responsiblePlayerId') IS NULL
                                                                  THEN 'responsiblePlayerId is not a player'
                   END AS problem
            FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, ord)
        ) x WHERE problem IS NOT NULL;
        IF v_msg IS NOT NULL THEN
            RAISE EXCEPTION '%', v_msg;
        END IF;

        ------------------------------------------------------------------
        -- Soft checks: recorded in import_batch.warnings, load continues
        ------------------------------------------------------------------
        -- Serve timestamps that go backwards (within or across points).
        SELECT v_warn || coalesce(jsonb_agg(format(
                   'point %s serve %s: timestamp %s is earlier than the previous serve (%s)',
                   p_ord, s_ord, ts, prev_ts)), '[]')
          INTO v_warn
          FROM (SELECT p_ord, s_ord, ts,
                       lag(ts) OVER (ORDER BY p_ord, s_ord) AS prev_ts
                  FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, p_ord),
                       jsonb_array_elements(pt->'serves') WITH ORDINALITY s(sv, s_ord),
                       LATERAL (SELECT (sv->>'timestamp')::numeric AS ts) t) z
         WHERE ts < prev_ts;

        -- Server on a serve differs from the point's server; attempts not 1, 2.
        SELECT v_warn || coalesce(jsonb_agg(msg), '[]') INTO v_warn FROM (
            SELECT 'point ' || p_ord || ' serve ' || s_ord || ': ' || CASE
                       WHEN sv->>'playerId' <> pt->>'serverId'
                           THEN 'playerId differs from the point''s serverId'
                       WHEN (sv->>'serveAttempt')::int <> s_ord
                           THEN format('serveAttempt is %s, expected %s', sv->>'serveAttempt', s_ord)
                       WHEN sv->>'faultType' IS NOT NULL
                        AND analyzer_fault_type(sv->>'faultType') = 'other'
                        AND lower(sv->>'faultType') <> 'other'
                           THEN format('unknown faultType "%s" stored as other', sv->>'faultType')
                   END AS msg
              FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, p_ord),
                   jsonb_array_elements(pt->'serves') WITH ORDINALITY s(sv, s_ord)
        ) z WHERE msg IS NOT NULL;

        -- Unknown outcome labels, and responsible player on an unexpected side
        -- (a kill should be credited to the winning team, an error to the losing one).
        SELECT v_warn || coalesce(jsonb_agg(msg), '[]') INTO v_warn FROM (
            SELECT 'point ' || ord || ': ' || CASE
                       WHEN analyzer_end_reason(pt->>'outcome') = 'other'
                        AND lower(btrim(coalesce(pt->>'outcome', ''))) <> 'other'
                           THEN format('unknown outcome "%s" stored as other', pt->>'outcome')
                       WHEN analyzer_end_reason(pt->>'outcome') = 'violation'
                        AND pt->>'violationType' IS NOT NULL
                        AND analyzer_violation_type(pt->>'violationType') = 'other'
                        AND lower(pt->>'violationType') <> 'other'
                           THEN format('unknown violationType "%s" stored as other', pt->>'violationType')
                       WHEN analyzer_end_reason(pt->>'outcome') <> 'violation'
                        AND pt->>'violationType' IS NOT NULL
                           THEN 'violationType on a point that is not a violation; ignored'
                       WHEN analyzer_end_reason(pt->>'outcome') = 'hit_winner'
                        AND (v_sidemap->>(pt->>'responsiblePlayerId'))::int
                            <> right(pt->>'winningTeam', 1)::int
                           THEN 'kill credited to a player on the losing team'
                       WHEN analyzer_end_reason(pt->>'outcome') IN
                            ('hitting_error', 'defense_error', 'receive_error', 'set_error', 'violation')
                        AND (v_sidemap->>(pt->>'responsiblePlayerId'))::int
                            = right(pt->>'winningTeam', 1)::int
                           THEN 'error charged to a player on the winning team'
                   END AS msg
              FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, ord)
        ) z WHERE msg IS NOT NULL;

        -- v2 receiver: must be on the other team, and the same on every attempt.
        SELECT v_warn || coalesce(jsonb_agg(msg), '[]') INTO v_warn FROM (
            SELECT 'point ' || ord || ': ' || CASE
                       WHEN v_sidemap->>rid IS NULL
                           THEN format('receiverId "%s" is not a player; receiver left empty', rid)
                       WHEN (v_sidemap->>rid)::int = (v_sidemap->>(pt->>'serverId'))::int
                           THEN 'receiver is on the serving team; receiver left empty'
                       WHEN n_rid > 1
                           THEN 'serve attempts name different receivers; the first was used'
                   END AS msg
              FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, ord),
                   LATERAL (SELECT count(DISTINCT sv->>'receiverId') AS n_rid,
                                   (SELECT s2->>'receiverId' FROM jsonb_array_elements(pt->'serves') s2
                                     WHERE s2->>'receiverId' IS NOT NULL LIMIT 1) AS rid
                              FROM jsonb_array_elements(pt->'serves') sv) r
             WHERE rid IS NOT NULL
        ) z WHERE msg IS NOT NULL;

        -- v2 rally: unknown touch types and players.
        SELECT v_warn || coalesce(jsonb_agg(msg), '[]') INTO v_warn FROM (
            SELECT 'point ' || ord || ' touch ' || r_ord || ': ' || CASE
                       WHEN v_pmap->>(r->>'playerId') IS NULL
                           THEN format('playerId "%s" is not a player', r->>'playerId')
                       WHEN r->>'type' NOT IN ('Hit', 'Defensive Touch', 'Set', 'Far Set')
                           THEN format('unknown touch type "%s" stored as touch', r->>'type')
                   END AS msg
              FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, ord),
                   jsonb_array_elements(coalesce(pt->'rally', '[]')) WITH ORDINALITY x(r, r_ord)
        ) z WHERE msg IS NOT NULL;

        -- The top-level serves list should be the same serves as inside points.
        IF p_payload ? 'serves' AND (
               SELECT array_agg(sv->>'id' ORDER BY sv->>'id')
                 FROM jsonb_array_elements(p_payload->'serves') sv)
           IS DISTINCT FROM (
               SELECT array_agg(sv->>'id' ORDER BY sv->>'id')
                 FROM jsonb_array_elements(p_payload->'points') pt,
                      jsonb_array_elements(pt->'serves') sv) THEN
            v_warn := v_warn || jsonb_build_array(
                'top-level serves list differs from the serves inside points; points were used');
        END IF;

        ------------------------------------------------------------------
        -- Re-export: drop the games that held any of these points
        ------------------------------------------------------------------
        WITH old AS (
            SELECT DISTINCT g.game_id, g.match_id, g.import_batch_id
              FROM point p JOIN game g USING (game_id)
             WHERE p.external_id IN (SELECT pt->>'id'
                                       FROM jsonb_array_elements(p_payload->'points') pt)
        ), upd AS (
            UPDATE import_batch SET status = 'superseded'
             WHERE import_batch_id IN (SELECT import_batch_id FROM old)
        ), del AS (
            DELETE FROM game WHERE game_id IN (SELECT game_id FROM old)
            RETURNING match_id
        )
        SELECT max(match_id) INTO v_match_id FROM del;

        -- Target match: by match_key, else the match those points came from.
        v_key := coalesce(p_match->>'match_key',
                          p_payload->'match'->>'id',
                          'analyzer:' || (p_payload->'points'->0->>'id'));
        IF v_key IS DISTINCT FROM 'analyzer:' || (p_payload->'points'->0->>'id') THEN
            -- An old match left empty by the re-export (key changed) goes away.
            DELETE FROM match m
             WHERE m.match_id = v_match_id
               AND m.external_id IS DISTINCT FROM v_key
               AND NOT EXISTS (SELECT 1 FROM game g WHERE g.match_id = m.match_id);
            SELECT match_id INTO v_match_id
              FROM match WHERE source = 'analyzer' AND external_id = v_key;
        END IF;

        ------------------------------------------------------------------
        -- Tournament context (only when match info provides it)
        ------------------------------------------------------------------
        v_context := coalesce(p_match->>'context',
                              CASE WHEN p_match ? 'tournament' THEN 'tournament'
                                   ELSE 'scrimmage' END)::match_context;

        IF v_context = 'tournament' THEN
            IF p_match->'tournament'->>'name' IS NULL
               OR p_match->'tournament'->>'start_date' IS NULL
               OR p_match->'division'->>'name' IS NULL THEN
                RAISE EXCEPTION 'tournament matches need tournament.name, tournament.start_date and division.name in match info';
            END IF;
            INSERT INTO tournament (name, start_date, end_date, city, region, country_code, source)
            VALUES (p_match->'tournament'->>'name',
                    (p_match->'tournament'->>'start_date')::date,
                    coalesce((p_match->'tournament'->>'end_date')::date,
                             (p_match->'tournament'->>'start_date')::date),
                    p_match->'tournament'->>'city', p_match->'tournament'->>'region',
                    p_match->'tournament'->>'country_code', 'analyzer')
            ON CONFLICT ON CONSTRAINT tournament_natural_key DO NOTHING;
            SELECT tournament_id INTO v_tourn FROM tournament
             WHERE name = p_match->'tournament'->>'name'
               AND start_date = (p_match->'tournament'->>'start_date')::date;

            INSERT INTO division (tournament_id, name, category, skill_level)
            VALUES (v_tourn, p_match->'division'->>'name',
                    p_match->'division'->>'category', p_match->'division'->>'skill_level')
            ON CONFLICT (tournament_id, name) DO NOTHING;
            SELECT division_id INTO v_div FROM division
             WHERE tournament_id = v_tourn AND name = p_match->'division'->>'name';

            FOR v_i IN 1..2 LOOP
                INSERT INTO entry (division_id, team_id, team_name, seed)
                VALUES (v_div, v_team[v_i], p_match->'team_names'->>(v_i - 1),
                        (p_match->'seeds'->>(v_i - 1))::int)
                ON CONFLICT (division_id, team_id) DO UPDATE
                    SET team_name = coalesce(entry.team_name, EXCLUDED.team_name),
                        seed      = coalesce(entry.seed, EXCLUDED.seed);
            END LOOP;
        END IF;

        ------------------------------------------------------------------
        -- Match: reuse (adding a game) or create
        ------------------------------------------------------------------
        IF v_match_id IS NOT NULL THEN
            SELECT (team1_id = v_team[2] AND team2_id = v_team[1]) INTO v_flip
              FROM match WHERE match_id = v_match_id;
            IF NOT v_flip AND NOT EXISTS (
                   SELECT 1 FROM match WHERE match_id = v_match_id
                      AND team1_id = v_team[1] AND team2_id = v_team[2]) THEN
                RAISE EXCEPTION 'match "%" already exists with different teams', v_key;
            END IF;
            UPDATE match SET import_batch_id = v_batch WHERE match_id = v_match_id;
        ELSE
            IF NOT (p_match ? 'played_at') AND p_payload->'match'->>'playedOn' IS NULL THEN
                v_warn := v_warn || jsonb_build_array(
                    'no played_at given; using exportedAt as the match time');
            END IF;
            INSERT INTO match (context, division_id, stage, round_label, team1_id, team2_id,
                               played_at, best_of, status, source, external_id,
                               import_batch_id, has_point_data)
            VALUES (v_context, v_div, (p_match->>'stage')::match_stage, p_match->>'round',
                    v_team[1], v_team[2],
                    coalesce((p_match->>'played_at')::timestamptz,
                             (p_payload->'match'->>'playedOn')::date::timestamptz,
                             (p_payload->>'exportedAt')::timestamptz),
                    coalesce((p_match->>'best_of')::smallint, 1),
                    'partial', 'analyzer', v_key, v_batch, true)
            RETURNING match_id INTO v_match_id;
        END IF;

        ------------------------------------------------------------------
        -- Games, points, serves, rally touches
        ------------------------------------------------------------------
        -- v1 files are one game (game_number from match info, default 1);
        -- v2 points carry gameNumber, so one file can hold a whole match.
        -- Stored sides follow the match; v_flip swaps file sides when a later
        -- file lists the teams in the opposite order.
        FOR v_gno IN
            SELECT DISTINCT coalesce((pt->>'gameNumber')::smallint, v_game_no)
              FROM jsonb_array_elements(p_payload->'points') pt ORDER BY 1
        LOOP
            IF EXISTS (SELECT 1 FROM game WHERE match_id = v_match_id
                                            AND game_number = v_gno) THEN
                RAISE EXCEPTION 'match "%" already has game % from another file; pass a different game_number',
                    v_key, v_gno;
            END IF;

            INSERT INTO game (match_id, game_number, points_to, hard_cap, team1_score, team2_score,
                              complete, import_batch_id)
            VALUES (v_match_id, v_gno, v_points_to, v_hard_cap, 0, 0, false, v_batch)
            RETURNING game_id INTO v_game;

            INSERT INTO point (game_id, point_number, external_id, serving_side,
                               server_player_id, receiver_player_id, winner_side,
                               end_reason, violation_type, source_outcome, ended_by_player_id,
                               possessions, video_start_s)
            SELECT v_game,
                   row_number() OVER (ORDER BY ord),
                   pt->>'id',
                   CASE WHEN v_flip THEN 3 - srv_side ELSE srv_side END,
                   (v_pmap->>(pt->>'serverId'))::bigint,
                   -- receiver only if they are on the other team (else warned below)
                   CASE WHEN (v_sidemap->>rcv)::int = 3 - srv_side
                        THEN (v_pmap->>rcv)::bigint END,
                   CASE WHEN v_flip THEN 3 - win_side ELSE win_side END,
                   analyzer_end_reason(pt->>'outcome'),
                   CASE WHEN analyzer_end_reason(pt->>'outcome') = 'violation'
                         AND pt->>'violationType' IS NOT NULL
                        THEN analyzer_violation_type(pt->>'violationType') END,
                   pt->>'outcome',
                   (v_pmap->>(pt->>'responsiblePlayerId'))::bigint,
                   CASE WHEN analyzer_end_reason(pt->>'outcome') IN ('ace', 'double_fault') THEN 0 END,
                   (pt->'serves'->0->>'timestamp')::numeric   -- first attempt, even if a later one is mis-stamped
              FROM jsonb_array_elements(p_payload->'points') WITH ORDINALITY e(pt, ord),
                   LATERAL (SELECT (v_sidemap->>(pt->>'serverId'))::smallint AS srv_side,
                                   right(pt->>'winningTeam', 1)::smallint   AS win_side,
                                   (SELECT sv->>'receiverId'
                                      FROM jsonb_array_elements(pt->'serves') sv
                                     WHERE sv->>'receiverId' IS NOT NULL LIMIT 1) AS rcv) s
             WHERE coalesce((pt->>'gameNumber')::smallint, v_game_no) = v_gno;
        END LOOP;

        INSERT INTO serve_attempt (point_id, attempt_number, external_id, result, fault_type,
                                   played_through, hand, serve_style, video_s)
        SELECT p.point_id,
               s_ord,
               sv->>'id',
               CASE WHEN sv->>'legality' = 'Legal' THEN 'in' ELSE 'fault' END::serve_result,
               CASE WHEN sv->>'legality' = 'Legal' THEN NULL
                    WHEN sv->>'faultType' IS NOT NULL
                         THEN analyzer_fault_type(sv->>'faultType') END,
               CASE WHEN sv->>'legality' = 'Legal' THEN NULL
                    ELSE (sv->>'playedThrough')::boolean END,
               CASE sv->>'hand' WHEN 'Left' THEN 'L' WHEN 'Right' THEN 'R' END,
               lower(sv->>'type'),
               (sv->>'timestamp')::numeric
          FROM jsonb_array_elements(p_payload->'points') pt
          JOIN point p ON p.external_id = pt->>'id'
         CROSS JOIN jsonb_array_elements(pt->'serves') WITH ORDINALITY s(sv, s_ord);

        -- v3 replays come first in a point's events: the replayed serve,
        -- with the reason, by the point's server.
        INSERT INTO rally_event (point_id, seq, external_id, event_type, player_id, side,
                                 video_s, detail)
        SELECT p.point_id,
               row_number() OVER (PARTITION BY p.point_id ORDER BY rp_ord),
               rp->'serve'->>'id',
               'replay',
               p.server_player_id,
               p.serving_side,
               (rp->'serve'->>'timestamp')::numeric,
               jsonb_strip_nulls(jsonb_build_object(
                   'reason',       coalesce(rp->'serve'->>'replayReason', 'Other'),
                   'legality',     rp->'serve'->>'legality',
                   'fault_type',   rp->'serve'->>'faultType',
                   'result',       rp->'serve'->>'result',
                   'hand',         rp->'serve'->>'hand',
                   'serve_style',  lower(rp->'serve'->>'type')))
          FROM jsonb_array_elements(v_replays) WITH ORDINALITY r(rp, rp_ord)
          JOIN point p ON p.external_id = rp->>'point';

        -- v2 rally: the touches after the serve, in order (after any replays).
        INSERT INTO rally_event (point_id, seq, external_id, event_type, player_id, side,
                                 video_s, detail)
        SELECT p.point_id,
               (SELECT count(*) FROM jsonb_array_elements(v_replays) rp
                 WHERE rp->>'point' = pt->>'id') + r_ord,
               r->>'id',
               CASE r->>'type' WHEN 'Hit'             THEN 'hit'
                               WHEN 'Defensive Touch' THEN 'defense'
                               WHEN 'Set'             THEN 'set'
                               WHEN 'Far Set'         THEN 'far_set'
                               ELSE 'touch' END::rally_event_type,
               (v_pmap->>(r->>'playerId'))::bigint,
               CASE WHEN v_flip THEN 3 - (v_sidemap->>(r->>'playerId'))::int
                    ELSE (v_sidemap->>(r->>'playerId'))::int END,
               (r->>'timestamp')::numeric,
               -- detail keeps an unknown touch label, and (v3) whether a
               -- defensive touch was kept up or a set was weak.
               nullif(jsonb_strip_nulls(jsonb_build_object(
                   'source_type', CASE WHEN r->>'type' NOT IN ('Hit', 'Defensive Touch', 'Set', 'Far Set')
                                       THEN r->>'type' END,
                   'controlled',  (r->>'controlled')::boolean,
                   'weak',        (r->>'weak')::boolean)), '{}')
          FROM jsonb_array_elements(p_payload->'points') pt
          JOIN point p ON p.external_id = pt->>'id'
         CROSS JOIN jsonb_array_elements(coalesce(pt->'rally', '[]')) WITH ORDINALITY x(r, r_ord);

        -- Game score = tally of the tagged points. A tally that is itself a
        -- finished game (reaches points_to, 2 clear, or reaches hard_cap) marks
        -- the game complete, unless match info says game_complete = false.
        FOR v_game, v_gno IN
            SELECT game_id, game_number FROM game
             WHERE match_id = v_match_id AND import_batch_id = v_batch
        LOOP
            SELECT count(*) FILTER (WHERE winner_side = 1),
                   count(*) FILTER (WHERE winner_side = 2)
              INTO v_t1, v_t2
              FROM point WHERE game_id = v_game;
            v_complete := (greatest(v_t1, v_t2) >= v_points_to AND abs(v_t1 - v_t2) >= 2)
                       OR coalesce(greatest(v_t1, v_t2) >= v_hard_cap AND v_t1 <> v_t2, false);
            IF (p_match->>'game_complete')::boolean AND NOT v_complete THEN
                RAISE EXCEPTION 'game_complete was set but game % ends %-%, which is not a finished game to %',
                    v_gno, v_t1, v_t2, v_points_to;
            END IF;
            UPDATE game
               SET team1_score = v_t1, team2_score = v_t2,
                   complete = v_complete AND coalesce((p_match->>'game_complete')::boolean, true)
             WHERE game_id = v_game;
        END LOOP;

        -- Match result once enough complete games are in.
        -- best_of: match info, else at least enough to cover the games present
        -- (2-3 games -> best of 3, 4-5 -> best of 5).
        SELECT greatest(m.best_of,
                        coalesce((p_match->>'best_of')::smallint, 1),
                        CASE WHEN max(g.game_number) >= 4 THEN 5
                             WHEN max(g.game_number) >= 2 THEN 3 ELSE 1 END)
          INTO v_best_of
          FROM match m JOIN game g USING (match_id)
         WHERE m.match_id = v_match_id
         GROUP BY m.best_of;
        SELECT count(*) FILTER (WHERE winner_side = 1),
               count(*) FILTER (WHERE winner_side = 2)
          INTO v_g1, v_g2
          FROM game WHERE match_id = v_match_id;
        UPDATE match
           SET winner_side = CASE WHEN v_g1 > v_best_of / 2 THEN 1
                                  WHEN v_g2 > v_best_of / 2 THEN 2 END,
               status = CASE WHEN greatest(v_g1, v_g2) > v_best_of / 2
                             THEN 'completed' ELSE 'partial' END::match_status,
               best_of = v_best_of,
               has_point_data = true
         WHERE match_id = v_match_id;

        UPDATE import_batch
           SET status = 'loaded', loaded_at = now(), error = NULL,
               warnings = NULLIF(v_warn, '[]')
         WHERE import_batch_id = v_batch;
        RETURN v_match_id;

    EXCEPTION WHEN OTHERS THEN
        UPDATE import_batch SET status = 'rejected', error = SQLERRM
         WHERE import_batch_id = v_batch;
        RAISE WARNING 'import rejected (batch %): %', v_batch, SQLERRM;
        RETURN NULL;
    END;
END $$;
