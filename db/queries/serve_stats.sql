-- Serve efficiency per player, over every tagged point (complete or partial).
--   first_in_pct   first serves that were legal
--   second_in_pct  second serves that were legal, of points that needed one
--   ace_pct        aces per serving point
--   df_pct         double faults per serving point
--   hold_pct       serving points the serving team went on to win
SET search_path = roundnet, public;

WITH serving_point AS (
    SELECT p.point_id,
           p.server_player_id,
           p.end_reason,
           p.winner_side = p.serving_side                       AS held,
           bool_or(sa.attempt_number = 1 AND sa.result = 'in')  AS first_in,
           bool_or(sa.attempt_number = 2)                       AS needed_second,
           bool_or(sa.attempt_number = 2 AND sa.result = 'in')  AS second_in
      FROM point p
      JOIN serve_attempt sa USING (point_id)
     GROUP BY p.point_id
)
SELECT pl.display_name                                                    AS player,
       count(*)                                                           AS serving_points,
       round(100.0 * count(*) FILTER (WHERE first_in) / count(*), 1)      AS first_in_pct,
       round(100.0 * count(*) FILTER (WHERE second_in)
             / nullif(count(*) FILTER (WHERE needed_second), 0), 1)       AS second_in_pct,
       count(*) FILTER (WHERE end_reason = 'ace')                         AS aces,
       count(*) FILTER (WHERE end_reason = 'double_fault')                AS double_faults,
       round(100.0 * count(*) FILTER (WHERE end_reason = 'ace') / count(*), 1)          AS ace_pct,
       round(100.0 * count(*) FILTER (WHERE end_reason = 'double_fault') / count(*), 1) AS df_pct,
       round(100.0 * count(*) FILTER (WHERE held) / count(*), 1)          AS hold_pct
  FROM serving_point sp
  JOIN player pl ON pl.player_id = sp.server_player_id
 GROUP BY pl.display_name
 ORDER BY hold_pct DESC, serving_points DESC;

-- Fault types, as a share of each player's faults.
SELECT pl.display_name AS player,
       sa.fault_type,
       count(*)        AS faults,
       round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY pl.display_name), 1) AS pct_of_faults
  FROM serve_attempt sa
  JOIN point  p  USING (point_id)
  JOIN player pl ON pl.player_id = p.server_player_id
 WHERE sa.result = 'fault'
 GROUP BY pl.display_name, sa.fault_type
 ORDER BY pl.display_name, faults DESC;
