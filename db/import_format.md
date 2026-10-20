# Roundnet Analyzer export → database mapping

The loader is `import_analyzer_export(export, file_name, match_info)` in [import_analyzer.sql](import_analyzer.sql). It reads both versions of the Analyzer's `roundnet-match.json`:

- **v1** has no `formatVersion`. This is the app's original layout. [examples/2026-10-20_v1_partial_tagging.json](examples/2026-10-20_v1_partial_tagging.json) is a real one, with the player names changed.
- **v2** has `formatVersion: 2`. Everything it adds to v1 is additive.
- **v3** has `formatVersion: 3`. It adds the game format (`match.pointsTo`, `match.hardCap`), `points[].violationType`, the full IRF list of fault types, and the Defensive Error, Receive Error and Violation outcomes. This is what the app exports today; the other files in [examples/](examples/) are synthetic v3 exports.

Any other `formatVersion` is rejected.

## Layout

```jsonc
{
  "formatVersion": 2,                                  // v2; absent = v1
  "exportedAt": "2026-10-20T17:29:59.428Z",
  "match": { "id": "<uuid>", "playedOn": "2026-10-19",     // v2; playedOn may be null
             "pointsTo": 21, "hardCap": null },             // v3
  "players": [ { "id": "player-1", "name": "Alex" }, ... ],
  "teams":   [ ["player-1", "player-2"], ["player-3", "player-4"] ],  // teams[0] = "Team 1"
  "serves":  [ ...flat copy of every serve... ],
  "points":  [ {
      "id": "1e33a5fd-...",
      "gameNumber": 1,                                 // v2; default 1
      "serverId": "player-2",
      "serves": [ { "id": "df8a...", "timestamp": 26.647, "playerId": "player-2",
                    "receiverId": "player-4",           // v2; null if not tagged
                    "hand": "Right", "type": "Cut", "serveAttempt": 1,
                    "legality": "Fault", "faultType": "High", "playedThrough": false,
                    "result": "Fault" }, ... ],
      "winningTeam": "Team 2",
      "outcome": "Double Fault",
      "responsiblePlayerId": null,
      "violationType": null,                           // v3; set on "Violation" points
      "rally": [ { "id": "<uuid>", "timestamp": 28.1, "playerId": "player-3",
                   "type": "Defensive Touch" } ]        // v2; [] for aces and double faults
  } ]
}
```

## Field mapping

| Export | Table.column | Notes |
|---|---|---|
| `match.id` (v2) | `match.external_id` | Groups files into one match. `match_key` in match info overrides it |
| `match.playedOn` (v2) | `match.played_at` | `played_at` in match info overrides it. If neither is given, `exportedAt` is used with a warning |
| `match.pointsTo` (v3) | `game.points_to` | `points_to` in match info overrides it. Default 21 |
| `match.hardCap` (v3) | `game.hard_cap` | `hard_cap` in match info overrides it. Default none |
| `players[].name` | `player` via `player_external_id` (source `analyzer`, key = lower-cased name) | `player-1`…`player-4` are slots reused in every match, so the name is the identity. Use `player_ids` in match info to pin a slot to a known player |
| `teams[0]`, `teams[1]` | `team` (canonical pair), `match.team1_id` / `team2_id` | `"Team 1"` = side 1 |
| `points[].gameNumber` (v2) | `game.game_number` | Points are split into one game per number. In v1 the whole file is one game, numbered by `game_number` in match info (default 1) |
| `points[]` (order within a game) | `point.point_number` | |
| `points[].id` | `point.external_id` | Detects re-exports |
| `serverId` | `point.server_player_id`, and `serving_side` from the server's team | |
| `serves[].receiverId` (v2) | `point.receiver_player_id` | First non-null receiver on the point's serves |
| `winningTeam` | `point.winner_side` | |
| `outcome` | `point.end_reason` + `point.source_outcome` (verbatim) | Ace→`ace`, Kill→`hit_winner`, Offensive Error→`hitting_error`, Defensive Error→`defense_error`, Double Fault→`double_fault`, Receive Error→`receive_error`, Violation→`violation`, Other→`other`. Any other label becomes `other` with a warning |
| `violationType` (v3) | `point.violation_type` | Only on Violation points. Under Three Touches→`under_three_touches`, Catch→`catch`, No Hit Zone→`no_hit_zone`, Hit Own Team→`hit_own_team`, Cylinder→`cylinder`, Hinder→`hinder`, Simultaneous Contact→`simultaneous_contact`. Unknown labels become `other` with a warning |
| `responsiblePlayerId` | `point.ended_by_player_id` | |
| first serve's `timestamp` | `point.video_start_s` | |
| `serves[].serveAttempt`, `id` | `serve_attempt.attempt_number`, `external_id` | |
| `legality` | `serve_attempt.result` | Legal→`in`, Fault→`fault` |
| `faultType` | `serve_attempt.fault_type` | High→`high`, Rim→`rim`, Pocket→`pocket`, Missed Net→`miss`, Double Rim→`double_rim`, Short Toss→`short_toss`, Same Hand→`same_hand`, Foot on Line→`foot`, Dropped Toss→`dropped_toss`, Three Seconds→`three_seconds`. Unknown values become `other` with a warning |
| `playedThrough` | `serve_attempt.played_through` | A fault the receiver chose to play on |
| `hand` | `serve_attempt.hand` | Stored per serve, since players switch hands |
| `type` | `serve_attempt.serve_style` | Lower-cased (reverse, cut, tap-on) |
| `timestamp` | `serve_attempt.video_s` | Seconds into the video |
| `points[].rally[]` (v2) | `rally_event` (seq = position, `external_id` = id) | Hit→`hit` (v3), Defensive Touch→`defense`, Set→`set`, Far Set→`far_set`. Unknown types become `touch`, with the original label in `detail`. A v3 defensive touch's `controlled` flag (false = touched but lost) goes in `detail.controlled`, and a weak set's `weak: true` in `detail.weak`. `side` comes from the player's team. A null timestamp stays null |
| `serves[].replayed`, `replayReason` (v3) | `rally_event` with `event_type = 'replay'` | A replayed serve (IRF 3.2.5) isn't an attempt, so it's left out of `serve_attempt` and the attempt checks. Each one becomes a `replay` event at the start of its point's events (before the rally touches), by the server, with `detail` = reason ("Serve Dispute", "Hinder" or "Other"), legality, fault type, result, hand and serve style. Files without the field load as before |
| serve `result` (Ace/Returned/Fault) | not stored | Derivable from `legality` plus the point's outcome |
| top-level `serves[]` | not stored | Duplicates the nested serves; the loader only checks they agree. The serves CSV holds the same data and isn't needed |

## Match info (optional third argument)

Values here override what the file says.

```jsonc
{
  "match_key": "fall-classic-qf",       // v1: groups files into one match (v2 uses match.id)
  "game_number": 2,                     // v1 only: which game this file is (default 1)
  "game_complete": false,               // force partial; true = assert every game is finished
  "points_to": 21,                      // default: v3 match.pointsTo, else 21
  "hard_cap": 25,                       // default: v3 match.hardCap, else none
  "best_of": 3,                         // default: inferred from the highest game number
  "played_at": "2026-10-18T19:00:00-04:00",
  "context": "tournament",              // default: tournament if "tournament" is given, else scrimmage
  "tournament": { "name": "...", "start_date": "2026-10-18", "city": "..." },
  "division":   { "name": "Open", "category": "open" },
  "stage": "bracket", "round": "QF",
  "team_names": ["Alex/Blake", "Casey/Drew"], "seeds": [2, 7],
  "player_ids": { "player-4": 17 }      // pin slots to existing player_ids
}
```

## Games and results

Each game's score is the tally of its tagged points. When that tally is a finished game (it reaches `points_to` with a 2-point lead, or reaches `hard_cap`), the game is marked **complete** and gets a winner. Otherwise it's stored as **partial**. Once one side has won a majority of `best_of` complete games, the match is `completed` with a winner. Until then it stays `partial`. Partial matches feed serve, point and rally stats, but not win rates or head-to-head records.

The v1 example loads as a partial game at 5-3.

## Loader behaviour

- **Hard errors reject the whole file.** These are:
  - an unsupported `formatVersion`
  - missing players, teams or points arrays, or a team that isn't a pair
  - a server or responsible player who isn't in the match
  - `winningTeam` other than "Team 1" or "Team 2"
  - a point with 0 or more than 2 serves, or a `gameNumber` outside 1 to 5
  - an ace won by the receiving team
  - `game_complete: true` when a game isn't finished
  - a game number that another file already supplied for the same match

  Rejected files are kept in `import_batch` with `status = 'rejected'` and the error.
- **Soft issues load with warnings.** These go in `import_batch.warnings`:
  - serve timestamps that go backwards
  - a serve's `playerId` that differs from the point's server, or a gap in `serveAttempt` numbering
  - an unknown outcome, fault type, violation type or touch type
  - a `violationType` on a point that isn't a violation (it's ignored)
  - a kill credited to the losing team, or an error or violation charged to the winning team
  - a receiver on the serving team or not in the match (the receiver is left empty), or serves that name different receivers
  - the flat serves list disagreeing with the nested one
  - no date for the match

  The v1 example has one: in point 8, serve 2 is stamped 58.35s, before serve 1 at 62.38s.
- **Re-exports replace.** Loading the same file again does nothing. A new export that contains any already-loaded point id replaces the games those points were in, and the old file is marked `superseded`. Teams listed in the opposite order from the stored match are flipped automatically.

## Upgrading an existing database to v3

A database built from the earlier `ddl.sql` can't store the v3 fault and violation values yet. Run [migrate_v3.sql](migrate_v3.sql) once, then re-run `import_analyzer.sql`. The migration only adds enum values, the `game.hard_cap` and `point.violation_type` columns and their checks, so existing rows stay as they are. It also re-maps v1/v2 "Missed Net" serves that were stored as `other` to `miss`. A fresh database built from the current `ddl.sql` doesn't need it.
