-- Rankings and rolling form.
SET search_path = roundnet, public;

-- Leaderboard: match record and point win % over completed matches, ranked by
-- win %, with point differential as the tie-breaker.
SELECT dense_rank() OVER (ORDER BY avg(pm.won::int) DESC,
                                   sum(pm.points_won - pm.points_lost) DESC) AS rank,
       pl.display_name                                         AS player,
       count(*)                                                AS matches,
       count(*) FILTER (WHERE pm.won) || '-' || count(*) FILTER (WHERE NOT pm.won) AS record,
       round(100.0 * avg(pm.won::int), 1)                      AS win_pct,
       sum(pm.points_won - pm.points_lost)                     AS point_diff,
       count(DISTINCT pm.partner_id)                           AS partners
  FROM v_player_match pm
  JOIN player pl USING (player_id)
 GROUP BY pl.display_name
 ORDER BY rank, player;

-- Form: each player's matches in date order with a rolling 3-match win rate
-- and point differential, and their running record.
SELECT pl.display_name                                              AS player,
       pm.played_at::date                                           AS played_on,
       CASE WHEN pm.won THEN 'W' ELSE 'L' END                       AS result,
       pm.points_won - pm.points_lost                               AS point_diff,
       round(100.0 * avg(pm.won::int) OVER last3, 1)                AS win_pct_last3,
       sum(pm.points_won - pm.points_lost) OVER last3               AS point_diff_last3,
       sum(pm.won::int) OVER career || '-' ||
           sum((NOT pm.won)::int) OVER career                       AS running_record
  FROM v_player_match pm
  JOIN player pl USING (player_id)
WINDOW last3  AS (PARTITION BY pm.player_id ORDER BY pm.played_at, pm.match_id
                  ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
       career AS (PARTITION BY pm.player_id ORDER BY pm.played_at, pm.match_id)
 ORDER BY player, played_on;
