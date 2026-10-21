import { describe, expect, it } from "vitest"
import {
  countedServes,
  getGameWinner,
  getNextServe,
  getOtherTeam,
  tallyScore
} from "./rules.js"

const teams = [
  ["player-1", "player-2"],
  ["player-3", "player-4"]
]

// getNextServe only reads the server and receiver of a game's first
// point, plus who won each point, so later points carry just a winner.
function makeGame(
  winners,
  firstServerId = "player-1",
  firstReceiverId = "player-3"
) {
  return winners.map((winningTeam, index) =>
    index === 0
      ? {
        serverId: firstServerId,
        winningTeam,
        serves: [
          { playerId: firstServerId, receiverId: firstReceiverId }
        ]
      }
      : { winningTeam, serves: [] }
  )
}

// Alternating winners keep the score level, so no team reaches the
// target score.
function alternatingWinners(count) {
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0 ? "Team 1" : "Team 2"
  )
}

describe("countedServes", () => {
  it("leaves replayed serves out", () => {
    const point = {
      serves: [
        { id: "a", replayed: true },
        { id: "b", replayed: false },
        { id: "c" }
      ]
    }

    expect(countedServes(point).map((serve) => serve.id)).toEqual([
      "b",
      "c"
    ])
  })

  it("returns nothing when every serve was replayed", () => {
    const point = {
      serves: [{ replayed: true }, { replayed: true }]
    }

    expect(countedServes(point)).toEqual([])
  })
})

describe("getOtherTeam", () => {
  it("returns the opposing team", () => {
    expect(getOtherTeam("Team 1")).toBe("Team 2")
    expect(getOtherTeam("Team 2")).toBe("Team 1")
  })
})

describe("tallyScore", () => {
  it("starts a game at 0–0", () => {
    expect(tallyScore([])).toEqual({ "Team 1": 0, "Team 2": 0 })
  })

  it("counts the points each team won", () => {
    const gamePoints = makeGame([
      "Team 1",
      "Team 2",
      "Team 1",
      "Team 1"
    ])

    expect(tallyScore(gamePoints)).toEqual({ "Team 1": 3, "Team 2": 1 })
  })
})

describe("getGameWinner", () => {
  const score = (team1, team2) => ({ "Team 1": team1, "Team 2": team2 })

  it("has no winner on a tied score", () => {
    expect(getGameWinner(score(0, 0), 11, null)).toBeNull()
    expect(getGameWinner(score(10, 10), 11, null)).toBeNull()
  })

  it("has no winner before the target score", () => {
    expect(getGameWinner(score(10, 0), 11, null)).toBeNull()
  })

  it("ends the game at the target score with a two-point lead", () => {
    expect(getGameWinner(score(11, 9), 11, null)).toBe("Team 1")
    expect(getGameWinner(score(7, 11), 11, null)).toBe("Team 2")
  })

  it("keeps playing past the target score until a team leads by two", () => {
    expect(getGameWinner(score(11, 10), 11, null)).toBeNull()
    expect(getGameWinner(score(13, 13), 11, null)).toBeNull()
    expect(getGameWinner(score(12, 14), 11, null)).toBe("Team 2")
  })

  it("ends the game at the hard cap even with a one-point lead", () => {
    expect(getGameWinner(score(24, 23), 21, 25)).toBeNull()
    expect(getGameWinner(score(25, 24), 21, 25)).toBe("Team 1")
  })

  it("has no cap when the hard cap is not set", () => {
    expect(getGameWinner(score(25, 24), 21, null)).toBeNull()
  })
})

describe("getNextServe", () => {
  it("has nothing to suggest before the first point", () => {
    expect(getNextServe([], teams, 21)).toBeNull()
  })

  it("has nothing to suggest when the first receiver was not tagged", () => {
    const gamePoints = makeGame(["Team 1"], "player-1", null)

    expect(getNextServe(gamePoints, teams, 21)).toBeNull()
  })

  // Player 1 serves the first point to Player 3, so the serving order
  // is Player 1, Player 4, Player 2, Player 3. After the first point,
  // each server serves two points: first to the next player in that
  // order, then to the other opponent.
  it.each([
    [1, "player-4", "player-2"],
    [2, "player-4", "player-1"],
    [3, "player-2", "player-3"],
    [4, "player-2", "player-4"],
    [5, "player-3", "player-1"],
    [6, "player-3", "player-2"],
    [7, "player-1", "player-4"],
    [8, "player-1", "player-3"],
    [9, "player-4", "player-2"]
  ])(
    "after %i points, %s serves to %s",
    (pointsPlayed, serverId, receiverId) => {
      const gamePoints = makeGame(alternatingWinners(pointsPlayed))

      expect(getNextServe(gamePoints, teams, 21)).toEqual({
        serverId,
        receiverId
      })
    }
  )

  it("follows the same rotation when Team 2 serves first", () => {
    const gamePoints = makeGame(["Team 2"], "player-3", "player-2")

    expect(getNextServe(gamePoints, teams, 21)).toEqual({
      serverId: "player-1",
      receiverId: "player-4"
    })
  })

  it("gives each server one point once a team reaches the target score", () => {
    // 20 alternating points make it 10–10, then Team 1 goes up 11–10.
    const winners = [...alternatingWinners(20), "Team 1"]

    const nextServers = ["Team 2", "Team 1", "Team 2"].map(
      (winningTeam) => {
        const nextServe = getNextServe(makeGame(winners), teams, 11)
        winners.push(winningTeam)
        return nextServe
      }
    )

    // The receiver is left to the tagger once positions keep rotating.
    expect(nextServers).toEqual([
      { serverId: "player-3", receiverId: null },
      { serverId: "player-1", receiverId: null },
      { serverId: "player-4", receiverId: null }
    ])
  })
})
