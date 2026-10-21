// Replayed serves (IRF 3.2.5) are kept in the log but do not count
// as attempts or in the serve statistics.
export function countedServes(point) {
  return point.serves.filter((serve) => !serve.replayed)
}

export function getOtherTeam(teamName) {
  return teamName === "Team 1" ? "Team 2" : "Team 1"
}

export function tallyScore(gamePoints) {
  return {
    "Team 1": gamePoints.filter(
      (point) => point.winningTeam === "Team 1"
    ).length,
    "Team 2": gamePoints.filter(
      (point) => point.winningTeam === "Team 2"
    ).length
  }
}

// 3.4: first to pointsTo, win by two, unless a hard cap is
// reached first.
export function getGameWinner(score, pointsTo, hardCap) {
  const team1 = score["Team 1"]
  const team2 = score["Team 2"]
  const leader = team1 > team2 ? "Team 1" : "Team 2"
  const high = Math.max(team1, team2)

  if (team1 === team2) {
    return null
  }

  if (hardCap && high >= hardCap) {
    return leader
  }

  if (high >= pointsTo && Math.abs(team1 - team2) >= 2) {
    return leader
  }

  return null
}

// IRF serving order (4.2). The first server serves one point to
// the receiver across from them. After that, the servers take
// turns in the order first server, receiver's partner, first
// server's partner, first receiver, each serving two points: the
// first to the opponent next in that order, then, after switching
// sides with their partner, to the other opponent. Once the target
// score is reached in a win-by-two game, each server serves one
// point; the receiver is left to the tagger there, because
// positions keep rotating.
//
// Returns { serverId, receiverId } for the next point, or null when
// the first point of the game has no receiver tagged.
export function getNextServe(gamePoints, teams, pointsTo) {
  if (gamePoints.length === 0) {
    return null
  }

  const firstServerId = gamePoints[0].serverId
  const firstReceiverId =
    gamePoints[0].serves.find((serve) => serve.receiverId)
      ?.receiverId ?? null

  if (!firstReceiverId) {
    return null
  }

  const partnerOf = (playerId) =>
    teams.find((team) => team.includes(playerId))
      ?.find((id) => id !== playerId)

  const order = [
    firstServerId,
    partnerOf(firstReceiverId),
    partnerOf(firstServerId),
    firstReceiverId
  ]

  // Walk the points already played to find whose turn it is.
  let turn = 0
  let pointsInTurn = 0
  let overtime = false
  const score = { "Team 1": 0, "Team 2": 0 }

  gamePoints.forEach((point) => {
    score[point.winningTeam] += 1
    pointsInTurn += 1

    overtime =
      overtime ||
      Math.max(score["Team 1"], score["Team 2"]) >= pointsTo

    const turnLength = turn === 0 || overtime ? 1 : 2

    if (pointsInTurn >= turnLength) {
      turn += 1
      pointsInTurn = 0
    }
  })

  const index = turn % 4
  const serverId = order[index]

  if (overtime) {
    return { serverId, receiverId: null }
  }

  const receiverId =
    pointsInTurn === 0
      ? order[(index + 1) % 4]
      : order[(index + 3) % 4]

  return { serverId, receiverId }
}
