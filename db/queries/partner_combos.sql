-- Partnerships: match record from completed matches, plus point-level
-- performance from every tagged point (partial matches included).
SET search_path = roundnet, public;

WITH team_match AS (            -- one row per team per completed match
    SELECT team_id, match_id, won, games_won, games_lost
      FROM v_player_match
     WHERE player_id < partner_id -- v_player_match has a row per player; keep one per team
), team_points AS (             -- every tagged point, from each side's view
    SELECT CASE s.side WHEN 1 THEN m.team1_id ELSE m.team2_id END AS team_id,
           count(*)                                               AS points_played,
           count(*) FILTER (WHERE p.winner_side = s.side)         AS points_won,
           count(*) FILTER (WHERE p.serving_side = s.side)        AS serve_points,
           count(*) FILTER (WHERE p.serving_side = s.side AND p.winner_side = s.side)  AS holds,
           count(*) FILTER (WHERE p.serving_side <> s.side)       AS receive_points,
           count(*) FILTER (WHERE p.serving_side <> s.side AND p.winner_side = s.side) AS breaks
      FROM point p
      JOIN game  g USING (game_id)
      JOIN match m USING (match_id)
     CROSS JOIN (VALUES (1), (2)) AS s(side)
     GROUP BY 1
)
SELECT lo.display_name || ' / ' || hi.display_name                      AS partnership,
       count(tm.match_id)                                               AS matches,
       count(*) FILTER (WHERE tm.won)                                   AS wins,
       round(100.0 * count(*) FILTER (WHERE tm.won)
             / nullif(count(tm.match_id), 0), 1)                        AS match_win_pct,
       coalesce(sum(tm.games_won), 0) || '-' || coalesce(sum(tm.games_lost), 0) AS games,
       tp.points_won || '-' || (tp.points_played - tp.points_won)       AS points,
       round(100.0 * tp.points_won / tp.points_played, 1)               AS point_win_pct,
       round(100.0 * tp.holds  / nullif(tp.serve_points, 0), 1)         AS hold_pct,
       round(100.0 * tp.breaks / nullif(tp.receive_points, 0), 1)       AS break_pct
  FROM team t
  JOIN player lo ON lo.player_id = t.player_lo_id
  JOIN player hi ON hi.player_id = t.player_hi_id
  JOIN team_points tp USING (team_id)
  LEFT JOIN team_match tm USING (team_id)
 GROUP BY t.team_id, lo.display_name, hi.display_name, tp.points_won, tp.points_played,
          tp.holds, tp.serve_points, tp.breaks, tp.receive_points
 ORDER BY point_win_pct DESC;

-- Who each player does best with: point win % by partner.
SELECT me.display_name AS player,
       mate.display_name AS partner,
       sum(pm.points_won) AS points_won,
       sum(pm.points_lost) AS points_lost,
       round(100.0 * sum(pm.points_won) / nullif(sum(pm.points_won + pm.points_lost), 0), 1) AS point_win_pct,
       rank() OVER (PARTITION BY me.display_name
                    ORDER BY sum(pm.points_won)::numeric
                             / nullif(sum(pm.points_won + pm.points_lost), 0) DESC) AS rank_for_player
  FROM v_player_match pm
  JOIN player me   ON me.player_id   = pm.player_id
  JOIN player mate ON mate.player_id = pm.partner_id
 GROUP BY me.display_name, mate.display_name
 ORDER BY player, rank_for_player;
