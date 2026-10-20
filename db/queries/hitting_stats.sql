-- Hitting, defense and setting per player, computed the same way the
-- Analyzer's statistics panel does:
--   kill_pct            kills / hits
--   hitting_efficiency  (kills - offensive errors) / hits
-- Needs v3 rally data ('hit' events); hit-based columns are NULL otherwise.
SET search_path = roundnet, public;

WITH touches AS (
    SELECT player_id,
           count(*) FILTER (WHERE event_type = 'hit')                          AS hits,
           count(*) FILTER (WHERE event_type = 'defense')                      AS def_touches,
           count(*) FILTER (WHERE event_type = 'defense'
                              AND (detail->>'controlled')::boolean IS NOT FALSE) AS def_kept_up,
           count(*) FILTER (WHERE event_type IN ('set', 'far_set'))            AS sets,
           count(*) FILTER (WHERE event_type = 'far_set')                      AS far_sets,
           count(*) FILTER (WHERE event_type = 'set'
                              AND (detail->>'weak')::boolean)                  AS weak_sets
      FROM rally_event
     WHERE player_id IS NOT NULL
     GROUP BY player_id
), endings AS (
    SELECT ended_by_player_id                                        AS player_id,
           count(*) FILTER (WHERE end_reason = 'hit_winner')         AS kills,
           count(*) FILTER (WHERE end_reason = 'hitting_error')      AS offensive_errors,
           count(*) FILTER (WHERE end_reason = 'defense_error')      AS defensive_errors,
           count(*) FILTER (WHERE end_reason = 'receive_error')      AS receive_errors,
           count(*) FILTER (WHERE end_reason = 'violation')          AS violations
      FROM point
     WHERE ended_by_player_id IS NOT NULL
     GROUP BY ended_by_player_id
)
SELECT pl.display_name                                                          AS player,
       coalesce(t.hits, 0)                                                      AS hits,
       coalesce(e.kills, 0)                                                     AS kills,
       coalesce(e.offensive_errors, 0)                                          AS offensive_errors,
       round(100.0 * e.kills / nullif(t.hits, 0), 1)                            AS kill_pct,
       round(100.0 * (coalesce(e.kills, 0) - coalesce(e.offensive_errors, 0))
             / nullif(t.hits, 0), 1)                                            AS hitting_efficiency,
       coalesce(t.def_touches, 0)                                               AS def_touches,
       round(100.0 * t.def_kept_up / nullif(t.def_touches, 0), 1)               AS def_kept_up_pct,
       coalesce(t.sets, 0)                                                      AS sets,
       round(100.0 * t.weak_sets / nullif(t.sets - t.far_sets, 0), 1)           AS weak_set_pct,
       coalesce(e.receive_errors, 0)                                            AS receive_errors,
       coalesce(e.violations, 0)                                                AS violations
  FROM player pl
  LEFT JOIN touches t USING (player_id)
  LEFT JOIN endings e USING (player_id)
 WHERE t.player_id IS NOT NULL OR e.player_id IS NOT NULL
 ORDER BY hitting_efficiency DESC NULLS LAST;
