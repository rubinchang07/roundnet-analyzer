-- Head-to-head records between players who faced each other, from completed
-- matches: one row per pair, from the first player's point of view.
SET search_path = roundnet, public;

WITH faced AS (
    SELECT pm.player_id, opp.opp_id, pm.match_id, pm.won, pm.points_won, pm.points_lost
      FROM v_player_match pm
     CROSS JOIN LATERAL (VALUES (pm.opp1_player_id), (pm.opp2_player_id)) AS opp(opp_id)
)
SELECT a.display_name                                   AS player,
       b.display_name                                   AS opponent,
       count(*)                                         AS matches,
       count(*) FILTER (WHERE f.won) || '-' || count(*) FILTER (WHERE NOT f.won) AS record,
       sum(f.points_won) || '-' || sum(f.points_lost)   AS points
  FROM faced f
  JOIN player a ON a.player_id = f.player_id
  JOIN player b ON b.player_id = f.opp_id
 WHERE a.display_name < b.display_name
 GROUP BY a.display_name, b.display_name
 ORDER BY matches DESC, player, opponent;

-- Team vs team, with every game score.
SELECT t1.display_name || ' / ' || t1p.display_name   AS team1,
       t2.display_name || ' / ' || t2p.display_name   AS team2,
       r.played_at::date                              AS played_on,
       r.team1_games || '-' || r.team2_games          AS games,
       string_agg(g.team1_score || '-' || g.team2_score, ', ' ORDER BY g.game_number) AS game_scores
  FROM v_match_result r
  JOIN team ta  ON ta.team_id = r.team1_id
  JOIN team tb  ON tb.team_id = r.team2_id
  JOIN player t1  ON t1.player_id  = ta.player_lo_id
  JOIN player t1p ON t1p.player_id = ta.player_hi_id
  JOIN player t2  ON t2.player_id  = tb.player_lo_id
  JOIN player t2p ON t2p.player_id = tb.player_hi_id
  JOIN game g ON g.match_id = r.match_id
 WHERE r.status = 'completed'
 GROUP BY r.match_id, r.played_at, r.team1_games, r.team2_games,
          t1.display_name, t1p.display_name, t2.display_name, t2p.display_name
 ORDER BY played_on;
