import { useEffect, useRef, useState } from "react"
import "./App.css"

function loadSavedMatch() {
  const savedMatch = localStorage.getItem("roundnetMatch")

  if (!savedMatch) {
    return null
  }

  try {
    return JSON.parse(savedMatch)
  } catch {
    return null
  }
}

const TOUCH_TYPES = [
  "Hit",
  "Defensive Touch",
  "Set",
  "Far Set"
]

// Optional extra touches the tagger can add during a rally. Hits and
// defensive touches are asked for by the rally flow itself.
const EXTRA_TOUCH_TYPES = [
  "Set",
  "Far Set"
]

// IRF rules, July 2026, 4.5. The first four keep the labels
// earlier exports used.
const SERVE_FAULT_TYPES = [
  "High",          // 4.5.9  above the receiver's shoulder
  "Rim",           // 4.5.6  rim or legs hit directly
  "Pocket",        // 4.5.7  side pocket
  "Missed Net",    // 4.5.10 misses the set entirely
  "Double Rim",    // 4.5.11 hits the set more than once
  "Short Toss",    // 4.5.1  struck before travelling 10 cm
  "Same Hand",     // 4.5.14 released and struck with the same hand
  "Foot on Line",  // 4.5.2, 4.5.4–4.5.5 on the line, into the circle, or a moved foot
  "Dropped Toss",  // 4.5.12 released and not struck
  "Three Seconds"  // 4.5.13 no toss within 3 seconds of "service"
]

// Never played through: 4.4.2.2 for a miss, double rim, dropped toss
// or late toss, and foot faults as well.
const NO_PLAY_THROUGH_FAULTS = [
  "Missed Net",
  "Double Rim",
  "Foot on Line",
  "Dropped Toss",
  "Three Seconds"
]

// Point outcomes after a rally. `side` is the team the
// responsible player is on.
const RALLY_OUTCOMES = [
  { name: "Kill", side: "winner" },
  { name: "Offensive Error", side: "loser" },
  { name: "Defensive Error", side: "loser" },
  { name: "Receive Error", side: "loser" },
  { name: "Violation", side: "loser" }
]

// Point-loss infractions (IRF rules chapters 5 and 6).
const VIOLATION_TYPES = [
  "Under Three Touches", // 5.5.1.7 serve returned in under 3 touches
  "Catch",               // 5.4.2
  "No Hit Zone",         // 5.6.2 hitter in the NHZ
  "Hit Own Team",        // 5.5.5.2
  "Cylinder",            // 6.2.2.1
  "Hinder"               // 6.6
]

const POINTS_TO_OPTIONS = [11, 15, 21]

const EXPORT_FORMAT_VERSION = 3

function getOtherTeam(teamName) {
  return teamName === "Team 1" ? "Team 2" : "Team 1"
}

function tallyScore(gamePoints) {
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
function getGameWinner(score, pointsTo, hardCap) {
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
function getNextServe(gamePoints, teams, pointsTo) {
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

function App() {
  const videoRef = useRef(null)

  const savedMatch = loadSavedMatch()

  const [videoURL, setVideoURL] = useState(null)

  const [serves, setServes] = useState(
    savedMatch?.serves ?? []
  )

  const [players, setPlayers] = useState(
    savedMatch?.players ?? [
      { id: "player-1", name: "Player 1" },
      { id: "player-2", name: "Player 2" },
      { id: "player-3", name: "Player 3" },
      { id: "player-4", name: "Player 4" }
    ]
  )

  const [selectedPlayerId, setSelectedPlayerId] = useState(null)
  const [selectedReceiverId, setSelectedReceiverId] = useState(null)

  const [matchId, setMatchId] = useState(
    savedMatch?.matchId ?? crypto.randomUUID()
  )
  const [playedOn, setPlayedOn] = useState(
    savedMatch?.playedOn ?? ""
  )
  const [gameNumber, setGameNumber] = useState(
    savedMatch?.gameNumber ?? 1
  )
  const [pointsTo, setPointsTo] = useState(
    savedMatch?.pointsTo ?? 21
  )
  const [hardCap, setHardCap] = useState(
    savedMatch?.hardCap ?? null
  )

  const teams = [
    ["player-1", "player-2"],
    ["player-3", "player-4"]
  ]

  function getPlayerName(playerId) {
    return (
      players.find((player) => player.id === playerId)?.name ??
      "Unknown Player"
    )
  }

  function getOpponentIds(playerId) {
    const team = getPlayerTeam(playerId)

    if (team === "Team 1") {
      return teams[1]
    }

    if (team === "Team 2") {
      return teams[0]
    }

    return []
  }

  function getPlayerTeam(playerId) {
    if (teams[0].includes(playerId)) {
      return "Team 1"
    }

    if (teams[1].includes(playerId)) {
      return "Team 2"
    }

    return null
  }

  const team1 = teams[0].map(getPlayerName)
  const team2 = teams[1].map(getPlayerName)

  const [selectedServeType, setSelectedServeType] = useState("None")
  const [serveStatus, setServeStatus] = useState(null)
  const [selectedFaultType, setSelectedFaultType] = useState(null)
  const [selectedHand, setSelectedHand] = useState("None")

  const [points, setPoints] = useState(
    savedMatch?.points ?? []
  )

  const [currentPointServes, setCurrentPointServes] = useState(
    savedMatch?.currentPointServes ?? []
  )

  const [currentPointRally, setCurrentPointRally] = useState(
    savedMatch?.currentPointRally ?? []
  )
  const [selectedTouchType, setSelectedTouchType] = useState(null)

  const [pendingWinningTeam, setPendingWinningTeam] = useState(null)
  const [pendingOutcome, setPendingOutcome] = useState(null)
  const [pendingViolationType, setPendingViolationType] = useState(null)
  const [manualEnding, setManualEnding] = useState(false)

  const [expandedPlayerId, setExpandedPlayerId] = useState(null)
  const [expandedTeam, setExpandedTeam] = useState(null)

  const currentPointServerId =
    currentPointServes.length > 0
      ? currentPointServes[0].playerId
      : null

  const currentPointReceiverId =
    currentPointServes.find((serve) => serve.receiverId)
      ?.receiverId ?? null

  // -----------------------------
  // Score and serving order
  // -----------------------------

  const currentGamePoints = points.filter(
    (point) => (point.gameNumber ?? 1) === gameNumber
  )

  const gameScore = tallyScore(currentGamePoints)

  const gameWinner = getGameWinner(
    gameScore,
    pointsTo,
    hardCap
  )

  const nextServe =
    currentPointServes.length === 0 && !gameWinner
      ? getNextServe(currentGamePoints, teams, pointsTo)
      : null

  // The serving order fills in the server and receiver until the
  // tagger picks someone else.
  const activeServerId =
    selectedPlayerId ??
    currentPointServerId ??
    nextServe?.serverId ??
    null

  const activeReceiverId =
    selectedReceiverId ??
    currentPointReceiverId ??
    (activeServerId === nextServe?.serverId
      ? nextServe?.receiverId
      : null) ??
    null

  const [actionHistory, setActionHistory] = useState([])

  const [editingServeId, setEditingServeId] = useState(null)
  const [editHand, setEditHand] = useState("None")
  const [editServeType, setEditServeType] = useState("None")
  const [editReceiverId, setEditReceiverId] = useState(null)

  const [editingPointId, setEditingPointId] = useState(null)
  const [editWinningTeam, setEditWinningTeam] = useState(null)
  const [editPointOutcome, setEditPointOutcome] = useState(null)
  const [editResponsiblePlayerId, setEditResponsiblePlayerId] = useState(null)
  const [editViolationType, setEditViolationType] = useState(null)
  const [editRally, setEditRally] = useState([])

  const [editServeStatus, setEditServeStatus] = useState(null)
  const [editFaultType, setEditFaultType] = useState(null)
  const [editPlayedThrough, setEditPlayedThrough] = useState(null)
  const [editServeResult, setEditServeResult] = useState(null)

  useEffect(() => {
    const matchData = {
      matchId,
      playedOn,
      gameNumber,
      pointsTo,
      hardCap,
      players,
      serves,
      points,
      currentPointServes,
      currentPointRally
    }

    localStorage.setItem(
      "roundnetMatch",
      JSON.stringify(matchData)
    )
  }, [
    matchId,
    playedOn,
    gameNumber,
    pointsTo,
    hardCap,
    players,
    serves,
    points,
    currentPointServes,
    currentPointRally
  ])

  // -----------------------------
  // Team statistics
  // -----------------------------

  const teamStats = ["Team 1", "Team 2"].map((teamName) => {
    const teamPoints = points.filter(
      (point) => point.winningTeam === teamName
    )

    const pointsWon = teamPoints.length

    const servingPoints = points.filter(
      (point) =>
        getPlayerTeam(point.serverId) === teamName
    )

    const servingPointsWon = servingPoints.filter(
      (point) => point.winningTeam === teamName
    ).length

    const receivingPoints = points.filter(
      (point) =>
        getPlayerTeam(point.serverId) !== teamName
    )

    const receivingPointsWon = receivingPoints.filter(
      (point) => point.winningTeam === teamName
    ).length

    const teamAces = points.filter(
      (point) =>
        point.winningTeam === teamName &&
        point.outcome === "Ace"
    ).length

    const teamDoubleFaults = points.filter(
      (point) =>
        getPlayerTeam(point.serverId) === teamName &&
        point.outcome === "Double Fault"
    ).length

    return {
      teamName,
      pointsWon,
      servingPoints: servingPoints.length,
      servingPointsWon,
      receivingPoints: receivingPoints.length,
      receivingPointsWon,
      aces: teamAces,
      doubleFaults: teamDoubleFaults
    }
  })

  // -----------------------------
  // Match controls
  // -----------------------------

  function handleVideoUpload(event) {
    const file = event.target.files[0]

    if (file) {
      const url = URL.createObjectURL(file)
      setVideoURL(url)
    }
  }

  function startNewMatch() {
    const confirmed = window.confirm(
      "Start a new match? Your current match data will be cleared."
    )

    if (!confirmed) return
    const hasMatchData =
      serves.length > 0 ||
      points.length > 0 ||
      currentPointServes.length > 0

    if (hasMatchData) {
      const confirmed = window.confirm(
        "Start a new match? This will clear the current analysis."
      )

      if (!confirmed) {
        return
      }
    }
    // 1. Reset player names
    setPlayers((currentPlayers) =>
      currentPlayers.map((player, index) => ({
        ...player,
        name: `Player ${index + 1}`
      }))
    )

    // 2. New match identity
    setMatchId(crypto.randomUUID())
    setPlayedOn("")
    setGameNumber(1)

    // 3. Clear serves
    setServes([])

    // 4. Clear points
    setPoints([])

    // 5. Clear current point
    setCurrentPointServes([])
    setCurrentPointRally([])

    // 6. Clear undo history
    setActionHistory([])

    // 7. Reset temporary selections
    setSelectedPlayerId(null)
    setSelectedReceiverId(null)
    setSelectedTouchType(null)
    setSelectedHand("None")
    setSelectedServeType("None")

    setServeStatus(null)
    setSelectedFaultType(null)

    setPendingWinningTeam(null)
    setPendingOutcome(null)
  }

  function startEditingServe(serve) {
    setEditingServeId(serve.id)

    setEditHand(serve.hand)
    setEditServeType(serve.type)
    setEditReceiverId(serve.receiverId ?? null)

    setEditServeStatus(serve.legality)
    setEditFaultType(serve.faultType)
    setEditPlayedThrough(serve.playedThrough)
    setEditServeResult(serve.result)
  }

  function startEditingPoint(points) {
    setEditingPointId(points.id)
    setEditWinningTeam(points.winningTeam)
    setEditPointOutcome(points.outcome)
    setEditResponsiblePlayerId(points.responsiblePlayerId)
    setEditViolationType(points.violationType ?? null)
    setEditRally(points.rally ?? [])
  }

  function saveServeEdit() {
    if (editingServeId === null) {
      return
    }

    const editedServeFields = {
      hand: editHand,
      type: editServeType,
      receiverId: editReceiverId,
      legality: editServeStatus,
      faultType: editFaultType,
      playedThrough: editPlayedThrough,
      result: editServeResult
    }

    // Find the original serve before changing anything
    const originalServe = serves.find(
      (serve) => serve.id === editingServeId
    )

    if (!originalServe) {
      return
    }

    const updatedServe = {
      ...originalServe,
      ...editedServeFields
    }

    const becomesDoubleFault =
      updatedServe.serveAttempt === 2 &&
      editServeStatus === "Fault" &&
      editPlayedThrough === false

    // Is this serve part of the unfinished current point?
    const isInCurrentPoint = currentPointServes.some(
      (serve) => serve.id === editingServeId
    )

    // Is this serve already inside a completed point?
    const containingPoint = points.find((point) =>
      point.serves.some(
        (serve) => serve.id === editingServeId
      )
    )

    const stopsBeingAce =
      containingPoint?.outcome === "Ace" &&
      editServeStatus === "Legal" &&
      editServeResult === "Returned"

    const stopsBeingDoubleFault =
      containingPoint?.outcome === "Double Fault" &&
      !becomesDoubleFault

    const latestPoint =
      points.length > 0
        ? points[points.length - 1]
        : null

    const isLatestPoint =
      containingPoint &&
      latestPoint &&
      containingPoint.id === latestPoint.id

    const becomesUnplayedFirstServeFault =
      updatedServe.serveAttempt === 1 &&
      editServeStatus === "Fault" &&
      editPlayedThrough === false

    if (
      containingPoint &&
      (
        becomesUnplayedFirstServeFault ||
        stopsBeingAce ||
        stopsBeingDoubleFault
      ) &&
      !isLatestPoint
    ) {
      alert(
        "This edit would reopen an earlier point. Structural edits can only be made to the most recent point."
      )
      return
    }

    saveSnapshot()

    setServes((currentServes) =>
      currentServes.map((serve) =>
        serve.id === editingServeId
          ? updatedServe
          : serve
      )
    )

    if (
      containingPoint &&
      becomesUnplayedFirstServeFault
    ) {
      // Update the serve in the master serve history
      setServes((currentServes) =>
        currentServes.map((serve) =>
          serve.id === editingServeId
            ? updatedServe
            : serve
        )
      )

      // Remove the old completed point
      setPoints((currentPoints) =>
        currentPoints.filter(
          (point) =>
            point.id !== containingPoint.id
        )
      )

      // Reopen the point with the edited first serve
      setCurrentPointServes([
        updatedServe
      ])
      setCurrentPointRally([])

      // Restore the original server
      setSelectedPlayerId(updatedServe.playerId)

      // Hand/type must be chosen for serve 2
      setSelectedHand("None")
      setSelectedServeType("None")

      // Close the editor
      setEditingServeId(null)
      setEditHand("None")
      setEditServeType("None")
      setEditServeStatus(null)
      setEditFaultType(null)
      setEditPlayedThrough(null)
      setEditServeResult(null)

      return
    }
    // --------------------------------
    // UPDATE CURRENT POINT SERVES
    // --------------------------------

    const updatedCurrentPointServes =
      currentPointServes.map((serve) =>
        serve.id === editingServeId
          ? {
            ...serve,
            ...editedServeFields
          }
          : serve
      )

    setCurrentPointServes(
      updatedCurrentPointServes
    )

    if (
      containingPoint &&
      stopsBeingAce
    ) {
      // Update the serve in the master serve history
      setServes((currentServes) =>
        currentServes.map((serve) =>
          serve.id === editingServeId
            ? updatedServe
            : serve
        )
      )

      // Remove the old completed Ace point
      setPoints((currentPoints) =>
        currentPoints.filter(
          (point) =>
            point.id !== containingPoint.id
        )
      )

      // Reopen the point with the edited returned serve
      setCurrentPointServes(
        containingPoint.serves.map((serve) =>
          serve.id === editingServeId
            ? updatedServe
            : serve
        )
      )

      setCurrentPointRally(containingPoint.rally ?? [])

      // Restore the server for the reopened point
      setSelectedPlayerId(
        containingPoint.serverId
      )

      // These can start clean
      setSelectedHand("None")
      setSelectedServeType("None")
      setServeStatus(null)
      setSelectedFaultType(null)

      // Clear any point-outcome workflow
      setPendingWinningTeam(null)
      setPendingOutcome(null)

      // Close edit mode
      setEditingServeId(null)
      setEditHand("None")
      setEditServeType("None")
      setEditServeStatus(null)
      setEditFaultType(null)
      setEditPlayedThrough(null)
      setEditServeResult(null)

      return
    }

    if (
      containingPoint &&
      stopsBeingDoubleFault
    ) {
      // Rebuild the original point's serves with
      // the edited second serve.
      const reopenedServes =
        containingPoint.serves.map((serve) =>
          serve.id === editingServeId
            ? updatedServe
            : serve
        )

      // Remove the old Double Fault point.
      setPoints((currentPoints) =>
        currentPoints.filter(
          (point) =>
            point.id !== containingPoint.id
        )
      )

      // These serves now belong to an unfinished point.
      setCurrentPointServes(reopenedServes)
      setCurrentPointRally(containingPoint.rally ?? [])

      // Restore the original server.
      setSelectedPlayerId(
        containingPoint.serverId
      )

      setSelectedHand("None")
      setSelectedServeType("None")
      setServeStatus(null)
      setSelectedFaultType(null)

      setPendingWinningTeam(null)
      setPendingOutcome(null)

      // Close editor.
      setEditingServeId(null)
      setEditHand("None")
      setEditServeType("None")
      setEditServeStatus(null)
      setEditFaultType(null)
      setEditPlayedThrough(null)
      setEditServeResult(null)

      return
    }

    // --------------------------------
    // CASE 1:
    // SERVE IS INSIDE COMPLETED POINT
    // --------------------------------

    if (containingPoint) {
      setPoints((currentPoints) =>
        currentPoints.map((point) => {
          if (point.id !== containingPoint.id) {
            return point
          }

          const updatedPointServes =
            point.serves.map((serve) =>
              serve.id === editingServeId
                ? {
                  ...serve,
                  ...editedServeFields
                }
                : serve
            )

          if (becomesDoubleFault) {
            const servingTeam =
              getPlayerTeam(originalServe.playerId)

            const receivingTeam =
              servingTeam === "Team 1"
                ? "Team 2"
                : "Team 1"

            return {
              ...point,
              serves: updatedPointServes,
              winningTeam: receivingTeam,
              outcome: "Double Fault",
              responsiblePlayerId: null,
              rally: []
            }
          }

          // Edited serve is now an Ace
          if (
            editServeStatus === "Legal" &&
            editServeResult === "Ace"
          ) {
            const servingTeam =
              getPlayerTeam(
                originalServe.playerId
              )

            return {
              ...point,
              serves: updatedPointServes,
              winningTeam: servingTeam,
              outcome: "Ace",
              responsiblePlayerId: null,
              rally: []
            }
          }

          return {
            ...point,
            serves: updatedPointServes
          }
        })
      )
    }

    // --------------------------------
    // CASE 2:
    // UNFINISHED SERVE BECOMES ACE
    // --------------------------------

    if (
      isInCurrentPoint &&
      editServeStatus === "Legal" &&
      editServeResult === "Ace"
    ) {
      const servingTeam =
        getPlayerTeam(
          originalServe.playerId
        )

      const newPoint = {
        id: crypto.randomUUID(),
        serverId:
          updatedCurrentPointServes[0].playerId,
        serves: updatedCurrentPointServes,
        gameNumber,
        winningTeam: servingTeam,
        outcome: "Ace",
        responsiblePlayerId: null,
        rally: []
      }

      setPoints((currentPoints) => [
        ...currentPoints,
        newPoint
      ])

      // Ace completes the point
      setCurrentPointServes([])
      setCurrentPointRally([])
    }

    if (
      isInCurrentPoint &&
      becomesDoubleFault
    ) {
      const servingTeam =
        getPlayerTeam(originalServe.playerId)

      const receivingTeam =
        servingTeam === "Team 1"
          ? "Team 2"
          : "Team 1"

      const updatedCurrentPointServes =
        currentPointServes.map((serve) =>
          serve.id === editingServeId
            ? updatedServe
            : serve
        )

      const newPoint = {
        id: crypto.randomUUID(),
        serverId: updatedCurrentPointServes[0].playerId,
        serves: updatedCurrentPointServes,
        gameNumber,
        winningTeam: receivingTeam,
        outcome: "Double Fault",
        responsiblePlayerId: null,
        rally: []
      }

      setPoints((currentPoints) => [
        ...currentPoints,
        newPoint
      ])

      setCurrentPointServes([])
      setCurrentPointRally([])

      setSelectedPlayerId(null)
      setSelectedReceiverId(null)
      setSelectedHand("None")
      setSelectedServeType("None")
    }

    // --------------------------------
    // CLOSE EDITOR
    // --------------------------------

    setEditingServeId(null)
    setEditHand("None")
    setEditServeType("None")
    setEditReceiverId(null)

    setEditServeStatus(null)
    setEditFaultType(null)
    setEditPlayedThrough(null)
    setEditServeResult(null)
  }

  function savePointEdit() {
    if (editingPointId === null) {
      return
    }

    saveSnapshot()

    setPoints((currentPoints) =>
      currentPoints.map((point) =>
        point.id === editingPointId
          ? {
            ...point,
            winningTeam: editWinningTeam,
            outcome: editPointOutcome,
            responsiblePlayerId: editResponsiblePlayerId,
            violationType:
              editPointOutcome === "Violation"
                ? editViolationType
                : null,
            rally: editRally
          }
          : point
      )
    )

    setEditingPointId(null)
    setEditWinningTeam(null)
    setEditPointOutcome(null)
    setEditResponsiblePlayerId(null)
    setEditViolationType(null)
    setEditRally([])
  }

  function cancelServeEdit() {
    setEditingServeId(null)

    setEditHand("None")
    setEditServeType("None")
    setEditReceiverId(null)

    setEditServeStatus(null)
    setEditFaultType(null)
    setEditPlayedThrough(null)
    setEditServeResult(null)
  }

  function cancelPointEdit() {
    setEditingPointId(null)
    setEditWinningTeam(null)
    setEditPointOutcome(null)
    setEditResponsiblePlayerId(null)
    setEditViolationType(null)
    setEditRally([])
  }

  function undoLastAction() {
    if (actionHistory.length == 0)
      return

    const lastSnapshot = actionHistory[actionHistory.length - 1]

    setServes(lastSnapshot.serves)
    setPoints(lastSnapshot.points)
    setCurrentPointServes(lastSnapshot.currentPointServes)
    setCurrentPointRally(lastSnapshot.currentPointRally ?? [])

    setSelectedPlayerId(lastSnapshot.selectedPlayerId)
    setSelectedReceiverId(lastSnapshot.selectedReceiverId ?? null)
    setSelectedHand(lastSnapshot.selectedHand)
    setSelectedServeType(lastSnapshot.selectedServeType)

    setServeStatus(lastSnapshot.serveStatus)
    setSelectedFaultType(lastSnapshot.selectedFaultType)

    setPendingWinningTeam(lastSnapshot.pendingWinningTeam)
    setPendingOutcome(lastSnapshot.pendingOutcome)
    setPendingViolationType(lastSnapshot.pendingViolationType ?? null)
    setManualEnding(lastSnapshot.manualEnding ?? false)

    setActionHistory(actionHistory.slice(0, -1))
  }

  function markServe(
    result,
    faultType = null,
    playedThrough = null
  ) {
    if (
      activeServerId === null ||
      selectedHand === "None" ||
      selectedServeType === "None"
    ) {
      alert("Select a server, hand, and serve type first.")
      return
    }

    saveSnapshot()

    const serverId = activeServerId
    const currentTime = videoRef.current.currentTime
    const serveAttempt = currentPointServes.length + 1

    const newServe = {
      id: crypto.randomUUID(),
      timestamp: currentTime,
      playerId: serverId,
      receiverId: activeReceiverId,
      hand: selectedHand,
      type: selectedServeType,
      serveAttempt,
      legality: serveStatus,
      faultType,
      playedThrough,
      result
    }

    const updatedPointServes = [
      ...currentPointServes,
      newServe
    ]

    setServes([
      ...serves,
      newServe
    ])

    setCurrentPointServes(updatedPointServes)

    setServeStatus(null)
    setSelectedFaultType(null)

    // After a fault, keep the same server,
    // but reset hand and serve type.
    if (serveStatus === "Fault") {
      setSelectedHand("None")
      setSelectedServeType("None")
    }

    const servingTeam =
      getPlayerTeam(serverId)

    // ACE
    if (result === "Ace") {
      const newPoint = {
        id: crypto.randomUUID(),
        serverId,
        serves: updatedPointServes,
        gameNumber,
        winningTeam: servingTeam,
        outcome: "Ace",
        responsiblePlayerId: null,
        rally: []
      }

      setPoints([
        ...points,
        newPoint
      ])

      setCurrentPointServes([])
      setCurrentPointRally([])

      setPendingWinningTeam(null)
      setPendingOutcome(null)

      setSelectedPlayerId(null)
      setSelectedReceiverId(null)
      setSelectedHand("None")
      setSelectedServeType("None")

      return
    }

    // DOUBLE FAULT
    const isDoubleFault =
      serveAttempt === 2 &&
      serveStatus === "Fault" &&
      playedThrough === false

    if (isDoubleFault) {
      const receivingTeam =
        servingTeam === "Team 1"
          ? "Team 2"
          : "Team 1"

      const newPoint = {
        id: crypto.randomUUID(),
        serverId,
        serves: updatedPointServes,
        gameNumber,
        winningTeam: receivingTeam,
        outcome: "Double Fault",
        responsiblePlayerId: null,
        rally: []
      }

      setPoints([
        ...points,
        newPoint
      ])

      setCurrentPointServes([])
      setCurrentPointRally([])

      setPendingWinningTeam(null)
      setPendingOutcome(null)

      setSelectedPlayerId(null)
      setSelectedReceiverId(null)
      setSelectedHand("None")
      setSelectedServeType("None")
    }
  }

  function saveSnapshot() {
    const snapshot = structuredClone({
      serves,
      points,
      currentPointServes,
      currentPointRally,
      selectedPlayerId,
      selectedReceiverId,
      selectedHand,
      selectedServeType,
      serveStatus,
      selectedFaultType,
      pendingWinningTeam,
      pendingOutcome,
      pendingViolationType,
      manualEnding
    })

    setActionHistory((previousHistory) => [
      ...previousHistory,
      snapshot
    ])
  }

  function finishPoint(
    winningTeam,
    outcome,
    responsiblePlayerId = null,
    violationType = null,
    rally = currentPointRally
  ) {
    if (currentPointServes.length === 0) {
      return
    }

    saveSnapshot()

    const newPoint = {
      id: crypto.randomUUID(),
      serverId: currentPointServes[0].playerId,
      serves: currentPointServes,
      gameNumber,
      winningTeam,
      outcome,
      responsiblePlayerId,
      violationType,
      rally
    }

    setPoints([
      ...points,
      newPoint
    ])

    setCurrentPointServes([])
    setCurrentPointRally([])
    setSelectedTouchType(null)

    setPendingWinningTeam(null)
    setPendingOutcome(null)
    setPendingViolationType(null)
    setManualEnding(false)

    setSelectedPlayerId(null)
    setSelectedReceiverId(null)
    setSelectedHand("None")
    setSelectedServeType("None")

    setServeStatus(null)
    setSelectedFaultType(null)
  }

  function recordTouch(playerId) {
    if (selectedTouchType === null) {
      return
    }

    saveSnapshot()

    const newTouch = {
      id: crypto.randomUUID(),
      timestamp: videoRef.current?.currentTime ?? null,
      playerId,
      type: selectedTouchType
    }

    setCurrentPointRally([
      ...currentPointRally,
      newTouch
    ])

    setSelectedTouchType(null)
  }

  function newTouch(type, playerId, extra = {}) {
    return {
      id: crypto.randomUUID(),
      timestamp: videoRef.current?.currentTime ?? null,
      playerId,
      type,
      ...extra
    }
  }

  function addTouch(type, playerId, extra = {}) {
    saveSnapshot()

    setCurrentPointRally([
      ...currentPointRally,
      newTouch(type, playerId, extra)
    ])
  }

  // The defender got a hand on the hit but couldn't keep it up, so
  // the hit still wins the point.
  function finishWithLostTouch(hit, defenderId) {
    finishPoint(
      getPlayerTeam(hit.playerId),
      "Kill",
      hit.playerId,
      null,
      [
        ...currentPointRally,
        newTouch("Defensive Touch", defenderId, { controlled: false })
      ]
    )
  }

  function deleteServe(serve) {
    const containingPoint = points.find((point) =>
      point.serves.some((pointServe) => pointServe.id === serve.id)
    )

    if (containingPoint) {
      deletePoint(
        containingPoint,
        "This serve belongs to a finished point. Delete the whole point and its serves?"
      )
      return
    }

    if (!window.confirm("Delete this serve?")) {
      return
    }

    saveSnapshot()

    // Renumber the attempts left in the unfinished point.
    const remaining = currentPointServes
      .filter((pointServe) => pointServe.id !== serve.id)
      .map((pointServe, index) => ({
        ...pointServe,
        serveAttempt: index + 1
      }))

    setServes(
      serves
        .filter((storedServe) => storedServe.id !== serve.id)
        .map(
          (storedServe) =>
            remaining.find((kept) => kept.id === storedServe.id) ??
            storedServe
        )
    )
    setCurrentPointServes(remaining)

    if (remaining.length === 0) {
      setCurrentPointRally([])
      setManualEnding(false)
      setPendingWinningTeam(null)
      setPendingOutcome(null)
      setPendingViolationType(null)
    }

    if (editingServeId === serve.id) {
      cancelServeEdit()
    }
  }

  function deletePoint(
    point,
    message = "Delete this point and its serves?"
  ) {
    if (!window.confirm(message)) {
      return
    }

    saveSnapshot()

    const pointServeIds = point.serves.map(
      (pointServe) => pointServe.id
    )

    setPoints(
      points.filter((storedPoint) => storedPoint.id !== point.id)
    )
    setServes(
      serves.filter(
        (storedServe) => !pointServeIds.includes(storedServe.id)
      )
    )

    if (editingPointId === point.id) {
      cancelPointEdit()
    }

    if (pointServeIds.includes(editingServeId)) {
      cancelServeEdit()
    }
  }

  function removeCurrentTouch(touchId) {
    saveSnapshot()

    setCurrentPointRally(
      currentPointRally.filter(
        (touch) => touch.id !== touchId
      )
    )
  }

  function selectServer(playerId) {
    setSelectedPlayerId(playerId)

    if (
      selectedReceiverId !== null &&
      !getOpponentIds(playerId).includes(selectedReceiverId)
    ) {
      setSelectedReceiverId(null)
    }
  }

  function summarizeRally(rally = []) {
    return TOUCH_TYPES
      .map((type) => [
        type,
        rally.filter((touch) => touch.type === type).length
      ])
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `${count} ${type}`)
      .join(" · ")
  }

  function jumpToTimestamp(time) {
    videoRef.current.currentTime = time
    videoRef.current.play()
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)

    return `${minutes}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`
  }

  function updatePlayerName(index, newName) {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player, playerIndex) =>
        playerIndex === index
          ? {
            ...player,
            name: newName
          }
          : player
      )
    )
  }

  function exportMatchJSON() {
    const exportServe = (serve) => ({
      ...serve,
      receiverId: serve.receiverId ?? null
    })

    const matchData = {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      match: {
        id: matchId,
        playedOn: playedOn || null,
        pointsTo,
        hardCap
      },
      players,
      teams,
      serves: serves.map(exportServe),
      points: points.map((point) => ({
        ...point,
        gameNumber: point.gameNumber ?? 1,
        violationType: point.violationType ?? null,
        serves: point.serves.map(exportServe),
        rally: point.rally ?? []
      }))
    }

    const json = JSON.stringify(
      matchData,
      null,
      2
    )

    // create Blob
    const blob = new Blob(
      [json],
      { type: "application/json" }
    )
    // create temporary URL
    const url = URL.createObjectURL(blob)
    // create link
    const link = document.createElement("a")
    link.href = url
    // trigger download
    link.download = "roundnet-match.json"
    link.click()
    // clean up URL
    URL.revokeObjectURL(url)
  }

  function exportServesCSV() {
    const headers = [
      "Serve Number",
      "Timestamp",
      "Player ID",
      "Player Name",
      "Team",
      "Receiver ID",
      "Receiver Name",
      "Hand",
      "Serve Type",
      "Serve Attempt",
      "Legality",
      "Fault Type",
      "Played Through",
      "Result"
    ]

    const rows = serves.map((serve, index) => [
      index + 1,
      serve.timestamp,
      serve.playerId,
      getPlayerName(serve.playerId),
      getPlayerTeam(serve.playerId),
      serve.receiverId ?? "",
      serve.receiverId
        ? getPlayerName(serve.receiverId)
        : "",
      serve.hand,
      serve.type,
      serve.serveAttempt,
      serve.legality,
      serve.faultType ?? "",
      serve.playedThrough ?? "",
      serve.result ?? ""
    ])

    const csv = [
      headers,
      ...rows
    ]
      .map(row => row.map(escapeCSVValue).join(","))
      .join("\n")

    const blob = new Blob(
      [csv],
      { type: "text/csv;charset=utf-8;" }
    )

    const url = URL.createObjectURL(blob)

    const link = document.createElement("a")
    link.href = url
    link.download = "roundnet-serves.csv"
    link.click()

    URL.revokeObjectURL(url)
  }

  function exportPointsCSV() {
    const headers = [
      "Point Number",
      "Game",
      "Server ID",
      "Server Name",
      "Serving Team",
      "Winning Team",
      "Outcome",
      "Violation Type",
      "Responsible Player ID",
      "Responsible Player Name",
      "Number of Serves",
      ...TOUCH_TYPES
    ]

    // create rows
    const rows = points.map((point, index) => [
      index + 1,
      point.gameNumber ?? 1,
      point.serverId,
      getPlayerName(point.serverId),
      getPlayerTeam(point.serverId),
      point.winningTeam,
      point.outcome,
      point.violationType ?? "",
      point.responsiblePlayerId ?? "",
      point.responsiblePlayerId
        ? getPlayerName(point.responsiblePlayerId)
        : "",
      point.serves.length,
      ...TOUCH_TYPES.map(
        (type) =>
          (point.rally ?? []).filter(
            (touch) => touch.type === type
          ).length
      )
    ])
    // create CSV from headers + rows
    const csv = [
      headers,
      ...rows
    ]
      .map(row => row.map(escapeCSVValue).join(","))
      .join("\n")
    const blob = new Blob(
      [csv],
      { type: "text/csv;charset=utf-8;" }
    )

    const url = URL.createObjectURL(blob)

    const link = document.createElement("a")
    link.href = url
    link.download = "roundnet-points.csv"
    link.click()

    URL.revokeObjectURL(url)
  }

  function escapeCSVValue(value) {
    const stringValue = String(value ?? "")
    return `"${stringValue.replaceAll('"', '""')}"`
  }

  // -----------------------------
  // Current rally state
  // -----------------------------

  const latestServe =
    currentPointServes[currentPointServes.length - 1]

  const rallyStarted =
    latestServe &&
    (
      (
        latestServe.legality === "Legal" &&
        latestServe.result === "Returned"
      ) ||
      latestServe.playedThrough === true
    )

  // Where the rally is, worked out from the touches so far. The
  // receiving team hits first; a defensive touch hands the next hit
  // to the toucher's team.
  const servingTeam = currentPointServerId
    ? getPlayerTeam(currentPointServerId)
    : null

  let hittingTeam = servingTeam ? getOtherTeam(servingTeam) : null
  let lastHit = null
  let lastDefensiveTouch = null

  currentPointRally.forEach((touch) => {
    if (touch.type === "Hit") {
      lastHit = touch
    }

    if (touch.type === "Defensive Touch") {
      lastHit = null
      lastDefensiveTouch = touch
      hittingTeam = getPlayerTeam(touch.playerId)
    }
  })

  // -----------------------------
  // Match statistics
  // -----------------------------

  const totalServes = serves.length

  // Game score after each point, for the points list.
  const runningScores = points.map((point, index) =>
    tallyScore(
      points
        .slice(0, index + 1)
        .filter(
          (earlier) =>
            (earlier.gameNumber ?? 1) === (point.gameNumber ?? 1)
        )
    )
  )

  const legalServes = serves.filter(
    (serve) => serve.legality === "Legal"
  ).length

  const faultServes = serves.filter(
    (serve) => serve.legality === "Fault"
  ).length

  const aces = serves.filter(
    (serve) => serve.result === "Ace"
  ).length

  const doubleFaults = points.filter(
    (point) => point.outcome === "Double Fault"
  ).length

  const firstServes = serves.filter(
    (serve) => serve.serveAttempt === 1
  )

  const firstServeLegal = firstServes.filter(
    (serve) => serve.legality === "Legal"
  ).length

  const secondServes = serves.filter(
    (serve) => serve.serveAttempt === 2
  )

  const secondServeLegal = secondServes.filter(
    (serve) => serve.legality === "Legal"
  ).length

  function percentage(part, total) {
    if (total === 0) {
      return "0.0"
    }

    return ((part / total) * 100).toFixed(1)
  }

  // -----------------------------
  // Player statistics
  // -----------------------------

  const playerStats = players
    .map((player) => {
      const playerServes = serves.filter(
        (serve) =>
          serve.playerId === player.id
      )

      const legal = playerServes.filter(
        (serve) =>
          serve.legality === "Legal"
      ).length

      const faults = playerServes.filter(
        (serve) =>
          serve.legality === "Fault"
      ).length

      const playerAces = playerServes.filter(
        (serve) =>
          serve.result === "Ace"
      ).length

      const playerFirstServes = playerServes.filter(
        (serve) =>
          serve.serveAttempt === 1
      )

      const playerFirstServeLegal =
        playerFirstServes.filter(
          (serve) =>
            serve.legality === "Legal"
        ).length

      const playerSecondServes = playerServes.filter(
        (serve) =>
          serve.serveAttempt === 2
      )

      const playerSecondServeLegal =
        playerSecondServes.filter(
          (serve) =>
            serve.legality === "Legal"
        ).length

      const playerDoubleFaults = points.filter(
        (point) =>
          point.serverId === player.id &&
          point.outcome === "Double Fault"
      ).length

      const playerKills = points.filter(
        (point) =>
          point.outcome === "Kill" &&
          point.responsiblePlayerId === player.id
      ).length

      const playerOffensiveErrors = points.filter(
        (point) =>
          point.outcome === "Offensive Error" &&
          point.responsiblePlayerId === player.id
      ).length

      const playerDefensiveErrors = points.filter(
        (point) =>
          point.outcome === "Defensive Error" &&
          point.responsiblePlayerId === player.id
      ).length

      const playerReceiveErrors = points.filter(
        (point) =>
          point.outcome === "Receive Error" &&
          point.responsiblePlayerId === player.id
      ).length

      const playerViolations = points.filter(
        (point) =>
          point.outcome === "Violation" &&
          point.responsiblePlayerId === player.id
      ).length

      // Rally touches
      const playerTouches = points.flatMap(
        (point) => point.rally ?? []
      ).filter(
        (touch) => touch.playerId === player.id
      )

      const lostDefensiveTouches = playerTouches.filter(
        (touch) =>
          touch.type === "Defensive Touch" &&
          touch.controlled === false
      ).length

      const touchCounts = Object.fromEntries(
        TOUCH_TYPES.map((type) => [
          type,
          playerTouches.filter(
            (touch) => touch.type === type
          ).length
        ])
      )

      // Receiving
      const servesReceived = serves.filter(
        (serve) =>
          serve.receiverId === player.id
      )

      const legalServesReceived = servesReceived.filter(
        (serve) => serve.legality === "Legal"
      )

      const timesAced = legalServesReceived.filter(
        (serve) => serve.result === "Ace"
      ).length

      // Who this player aced, and who aced this player
      const acesByReceiver = {}
      const acedByServer = {}

      playerServes.forEach((serve) => {
        if (serve.result === "Ace" && serve.receiverId) {
          acesByReceiver[serve.receiverId] =
            (acesByReceiver[serve.receiverId] ?? 0) + 1
        }
      })

      legalServesReceived.forEach((serve) => {
        if (serve.result === "Ace") {
          acedByServer[serve.playerId] =
            (acedByServer[serve.playerId] ?? 0) + 1
        }
      })

      // Serve breakdown
      const serveBreakdown = {}

      playerServes.forEach((serve) => {
        const key =
          `${serve.hand} ${serve.type}`

        if (!serveBreakdown[key]) {
          serveBreakdown[key] = {
            attempts: 0,
            legal: 0,
            faults: 0,
            aces: 0
          }
        }

        serveBreakdown[key].attempts += 1

        if (serve.legality === "Legal") {
          serveBreakdown[key].legal += 1
        }

        if (serve.legality === "Fault") {
          serveBreakdown[key].faults += 1
        }

        if (serve.result === "Ace") {
          serveBreakdown[key].aces += 1
        }
      })

      // Fault breakdown
      const faultBreakdown = Object.fromEntries(
        SERVE_FAULT_TYPES.map((faultType) => [faultType, 0])
      )

      playerServes.forEach((serve) => {
        if (
          serve.legality === "Fault" &&
          serve.faultType &&
          faultBreakdown[serve.faultType] !== undefined
        ) {
          faultBreakdown[serve.faultType] += 1
        }
      })

      // Point statistics
      const playerTeam =
        getPlayerTeam(player.id)

      const playerPointsServed = points.filter(
        (point) =>
          point.serverId === player.id
      )

      const playerServingWins =
        playerPointsServed.filter(
          (point) =>
            point.winningTeam === playerTeam
        ).length

      const firstServePoints =
        playerPointsServed.filter(
          (point) =>
            point.serves.length === 1
        )

      const firstServePointWins =
        firstServePoints.filter(
          (point) =>
            point.winningTeam === playerTeam
        ).length

      const secondServePoints =
        playerPointsServed.filter(
          (point) =>
            point.serves.length === 2
        )

      const secondServePointWins =
        secondServePoints.filter(
          (point) =>
            point.winningTeam === playerTeam
        ).length

      return {
        playerId: player.id,
        playerName: player.name,

        totalServes: playerServes.length,
        legal,
        faults,

        aces: playerAces,
        doubleFaults: playerDoubleFaults,

        firstServes: playerFirstServes.length,
        firstServeLegal: playerFirstServeLegal,

        secondServes: playerSecondServes.length,
        secondServeLegal: playerSecondServeLegal,

        serveBreakdown,
        faultBreakdown,

        pointsServed: playerPointsServed.length,
        servingWins: playerServingWins,

        firstServePoints: firstServePoints.length,
        firstServePointWins,

        secondServePoints: secondServePoints.length,
        secondServePointWins,

        kills: playerKills,
        offensiveErrors: playerOffensiveErrors,
        defensiveErrors: playerDefensiveErrors,
        receiveErrors: playerReceiveErrors,
        violations: playerViolations,

        hits: touchCounts["Hit"],
        defensiveTouches: touchCounts["Defensive Touch"],
        lostDefensiveTouches,
        sets: touchCounts["Set"],
        farSets: touchCounts["Far Set"],

        servesReceived: servesReceived.length,
        legalServesReceived: legalServesReceived.length,
        timesAced,
        acesByReceiver,
        acedByServer
      }
    })
    .filter(
      (stats) =>
        stats.totalServes > 0 ||
        stats.kills > 0 ||
        stats.offensiveErrors > 0 ||
        stats.defensiveErrors > 0 ||
        stats.receiveErrors > 0 ||
        stats.violations > 0 ||
        stats.hits > 0 ||
        stats.defensiveTouches > 0 ||
        stats.sets > 0 ||
        stats.farSets > 0 ||
        stats.servesReceived > 0
    )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Roundnet Analyzer</h1>

          <p>
            Upload match footage, tag serves, and review performance.
          </p>
        </div>
      </header>

      <main className="app-main">
        <section className="upload-card">

          <div className="video-upload-header">
            <strong>Match Video</strong>
            <span>Upload a local video file. Your video stays on this device.</span>
          </div>

          <input
            type="file"
            accept="video/*"
            onChange={handleVideoUpload}
          />
        </section>

        <section className="analyzer-grid">
          <div className="video-panel">
            {videoURL ? (
              <video
                ref={videoRef}
                src={videoURL}
                controls
                className="match-video"
              />
            ) : (
              <div className="video-placeholder">
                <div className="video-placeholder-content">
                  <div className="video-placeholder-icon">▶</div>
                  <strong>No match video loaded</strong>
                  <span>Upload match footage above to begin analyzing.</span>
                </div>
              </div>
            )}
          </div>

          <aside className="controls-panel">

            <div className="match-actions">
              <div className="match-action-group">
                <button
                  onClick={undoLastAction}
                  disabled={actionHistory.length === 0}
                >
                  Undo Last Action
                </button>

                <button
                  onClick={startNewMatch}
                  className="new-match-button"
                >
                  Start New Match
                </button>
              </div>

              <div className="export-actions">
                <span className="export-label">Export Data</span>

                <div className="export-buttons">
                  <button
                    onClick={exportMatchJSON}
                    disabled={serves.length === 0 && points.length === 0}
                  >
                    JSON
                  </button>

                  <button
                    onClick={exportServesCSV}
                    disabled={serves.length === 0}
                  >
                    Serves CSV
                  </button>

                  <button
                    onClick={exportPointsCSV}
                    disabled={points.length === 0}
                  >
                    Points CSV
                  </button>
                </div>
              </div>
            </div>

            {/* MATCH */}

            <div className="control-section">
              <h2>Match</h2>

              <div className="match-info">
                <label>
                  <span>Date Played</span>
                  <input
                    type="date"
                    value={playedOn}
                    onChange={(event) =>
                      setPlayedOn(event.target.value)
                    }
                  />
                </label>

                <div className="game-number">
                  <span>Game</span>

                  <div className="button-group">
                    <button
                      onClick={() =>
                        setGameNumber(gameNumber - 1)
                      }
                      disabled={gameNumber <= 1}
                    >
                      −
                    </button>

                    <strong>{gameNumber}</strong>

                    <button
                      onClick={() =>
                        setGameNumber(gameNumber + 1)
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div className="match-info">
                <div className="game-number">
                  <span>Points To</span>

                  <div className="button-group">
                    {POINTS_TO_OPTIONS.map((option) => (
                      <button
                        key={option}
                        className={
                          pointsTo === option
                            ? "selected-button"
                            : ""
                        }
                        onClick={() => setPointsTo(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <label>
                  <span>Hard Cap</span>
                  <input
                    type="number"
                    min={pointsTo + 1}
                    placeholder="None"
                    value={hardCap ?? ""}
                    onChange={(event) =>
                      setHardCap(
                        event.target.value === ""
                          ? null
                          : Number(event.target.value)
                      )
                    }
                  />
                </label>
              </div>

              <div className="scoreboard">
                <div>
                  <span>{team1.join(" / ")}</span>
                  <strong>{gameScore["Team 1"]}</strong>
                </div>

                <div>
                  <span>{team2.join(" / ")}</span>
                  <strong>{gameScore["Team 2"]}</strong>
                </div>
              </div>

              {gameWinner && (
                <div className="game-over">
                  <span>
                    Game {gameNumber} over:{" "}
                    {(gameWinner === "Team 1" ? team1 : team2).join(" / ")}{" "}
                    win {gameScore[gameWinner]}–{gameScore[getOtherTeam(gameWinner)]}
                  </span>

                  <button
                    onClick={() =>
                      setGameNumber(gameNumber + 1)
                    }
                    disabled={currentPointServes.length > 0}
                  >
                    Start Game {gameNumber + 1}
                  </button>
                </div>
              )}

              <p className="match-id">
                Match ID: {matchId.slice(0, 8)}
              </p>
            </div>

            {/* PLAYERS */}

            <div className="control-section">
              <h2>Players</h2>

              <div className="player-inputs">
                {players.map((player, index) => (
                  <input
                    key={player.id}
                    type="text"
                    value={player.name}
                    onChange={(event) =>
                      updatePlayerName(
                        index,
                        event.target.value
                      )
                    }
                  />
                ))}
              </div>

              <div className="team-summary">
                <p>
                  <strong>Team 1:</strong>{" "}
                  {team1.join(" / ")}
                </p>

                <p>
                  <strong>Team 2:</strong>{" "}
                  {team2.join(" / ")}
                </p>
              </div>
            </div>

            {/* SERVER */}

            <div className="control-section">
              <h2>Server</h2>

              <div className="button-group">
                {players.map((player) => (
                  <button
                    key={player.id}
                    onClick={() =>
                      selectServer(player.id)
                    }
                    disabled={
                      currentPointServerId !== null &&
                      currentPointServerId !==
                      player.id
                    }
                    className={
                      activeServerId === player.id
                        ? "selected-button"
                        : ""
                    }
                  >
                    {player.name}
                  </button>
                ))}
              </div>

              {nextServe &&
                selectedPlayerId === null && (
                  <p className="serving-order-hint">
                    Filled in from the serving order: {getPlayerName(nextServe.serverId)}
                    {nextServe.receiverId
                      ? ` to ${getPlayerName(nextServe.receiverId)}`
                      : " (pick the receiver)"}
                    . Pick someone else to override.
                  </p>
                )}

              {currentGamePoints.length === 0 &&
                currentPointServes.length === 0 && (
                  <p className="serving-order-hint">
                    Pick the first server and receiver of the game. After that the app follows the IRF serving order.
                  </p>
                )}
            </div>

            {/* RECEIVER */}

            {activeServerId !== null && (
              <div className="control-section">
                <h2>Receiver</h2>

                <div className="button-group">
                  {getOpponentIds(activeServerId).map(
                    (playerId) => (
                      <button
                        key={playerId}
                        onClick={() =>
                          setSelectedReceiverId(playerId)
                        }
                        disabled={
                          currentPointReceiverId !== null &&
                          currentPointReceiverId !== playerId
                        }
                        className={
                          activeReceiverId === playerId
                            ? "selected-button"
                            : ""
                        }
                      >
                        {getPlayerName(playerId)}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {/* HAND */}

            {!rallyStarted && (
            <div className="control-section">
              <h2>Hand</h2>

              <div className="button-group">
                <button
                  className={
                    selectedHand === "Left"
                      ? "selected-button"
                      : ""
                  }
                  onClick={() =>
                    setSelectedHand("Left")
                  }
                >
                  Left
                </button>

                <button
                  className={
                    selectedHand === "Right"
                      ? "selected-button"
                      : ""
                  }
                  onClick={() =>
                    setSelectedHand("Right")
                  }
                >
                  Right
                </button>
              </div>
            </div>
            )}

            {/* SERVE TYPE */}

            {!rallyStarted && (
            <div className="control-section">
              <h2>Serve Type</h2>

              <div className="button-group">
                {[
                  "Cut",
                  "Reverse",
                  "Jam",
                  "Drop",
                  "Tap-on"
                ].map((type) => (
                  <button
                    key={type}
                    className={
                      selectedServeType === type
                        ? "selected-button"
                        : ""
                    }
                    onClick={() =>
                      setSelectedServeType(type)
                    }
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* SERVE LEGALITY */}

            {videoURL && !rallyStarted && (
              <div className="control-section">
                <h2>Serve Legality</h2>

                <div className="button-group">
                  <button
                    className={
                      serveStatus === "Legal"
                        ? "selected-button"
                        : ""
                    }
                    onClick={() =>
                      setServeStatus("Legal")
                    }
                  >
                    Legal
                  </button>

                  <button
                    className={
                      serveStatus === "Fault"
                        ? "selected-button"
                        : ""
                    }
                    onClick={() =>
                      setServeStatus("Fault")
                    }
                  >
                    Fault
                  </button>
                </div>
              </div>
            )}

            {/* LEGAL SERVE RESULT */}

            {serveStatus === "Legal" && (
              <div className="control-section">
                <h2>Serve Result</h2>

                <div className="button-group">
                  <button
                    onClick={() =>
                      markServe("Ace")
                    }
                  >
                    Ace
                  </button>

                  <button
                    onClick={() =>
                      markServe("Returned")
                    }
                  >
                    Returned
                  </button>
                </div>
              </div>
            )}

            {/* FAULT TYPE */}

            {serveStatus === "Fault" && (
              <div className="control-section">
                <h2>Fault Type</h2>

                <div className="button-group">
                  {SERVE_FAULT_TYPES.map((faultType) => (
                    <button
                      key={faultType}
                      className={
                        selectedFaultType === faultType
                          ? "selected-button"
                          : ""
                      }
                      onClick={() =>
                        NO_PLAY_THROUGH_FAULTS.includes(faultType)
                          ? markServe("Fault", faultType, false)
                          : setSelectedFaultType(faultType)
                      }
                    >
                      {faultType}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* PLAYED THROUGH */}

            {serveStatus === "Fault" &&
              selectedFaultType && (
                <div className="control-section">
                  <h2>Played Through?</h2>

                  <div className="button-group">
                    <button
                      onClick={() =>
                        markServe(
                          "Fault",
                          selectedFaultType,
                          true
                        )
                      }
                    >
                      Yes
                    </button>

                    <button
                      onClick={() =>
                        markServe(
                          "Fault",
                          selectedFaultType,
                          false
                        )
                      }
                    >
                      No
                    </button>
                  </div>
                </div>
              )}

            {/* RALLY: WHO HIT IT */}

            {rallyStarted &&
              !manualEnding &&
              !lastHit && (
                <div className="control-section">
                  <h2>Who Hit the Ball?</h2>

                  <div className="button-group">
                    {players
                      .filter(
                        (player) =>
                          getPlayerTeam(player.id) === hittingTeam
                      )
                      .map((player) => (
                        <button
                          key={player.id}
                          onClick={() => addTouch("Hit", player.id)}
                        >
                          {player.name}
                        </button>
                      ))}

                    {lastDefensiveTouch ? (
                      <button
                        onClick={() =>
                          finishPoint(
                            getOtherTeam(hittingTeam),
                            "Defensive Error",
                            lastDefensiveTouch.playerId
                          )
                        }
                      >
                        Not returned (Defensive Error)
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          finishPoint(
                            servingTeam,
                            "Receive Error",
                            currentPointReceiverId
                          )
                        }
                      >
                        Not returned (Receive Error)
                      </button>
                    )}
                  </div>
                </div>
              )}

            {/* RALLY: AFTER THE HIT */}

            {rallyStarted &&
              !manualEnding &&
              lastHit && (
                <div className="control-section">
                  <h2>
                    {getPlayerName(lastHit.playerId)}'s Hit
                  </h2>

                  <div className="button-group">
                    <button
                      onClick={() =>
                        finishPoint(
                          hittingTeam,
                          "Kill",
                          lastHit.playerId
                        )
                      }
                    >
                      Kill
                    </button>

                    <button
                      onClick={() =>
                        finishPoint(
                          getOtherTeam(hittingTeam),
                          "Offensive Error",
                          lastHit.playerId
                        )
                      }
                    >
                      Offensive Error
                    </button>
                  </div>

                  <div className="touch-player-picker">
                    <span>Defensive touch, kept up by</span>

                    <div className="button-group">
                      {players
                        .filter(
                          (player) =>
                            getPlayerTeam(player.id) !== hittingTeam
                        )
                        .map((player) => (
                          <button
                            key={player.id}
                            onClick={() =>
                              addTouch(
                                "Defensive Touch",
                                player.id,
                                { controlled: true }
                              )
                            }
                          >
                            {player.name}
                          </button>
                        ))}
                    </div>
                  </div>

                  <div className="touch-player-picker">
                    <span>Touched but lost (still a kill) by</span>

                    <div className="button-group">
                      {players
                        .filter(
                          (player) =>
                            getPlayerTeam(player.id) !== hittingTeam
                        )
                        .map((player) => (
                          <button
                            key={player.id}
                            onClick={() =>
                              finishWithLostTouch(lastHit, player.id)
                            }
                          >
                            {player.name}
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              )}

            {/* RALLY: SETS AND THE TOUCH LOG */}

            {rallyStarted && !manualEnding && (
              <div className="control-section">
                <h2>Rally Touches</h2>

                <div className="button-group">
                  {EXTRA_TOUCH_TYPES.map((type) => (
                    <button
                      key={type}
                      className={
                        selectedTouchType === type
                          ? "selected-button"
                          : ""
                      }
                      onClick={() =>
                        setSelectedTouchType(
                          selectedTouchType === type
                            ? null
                            : type
                        )
                      }
                    >
                      {type}
                    </button>
                  ))}

                  <button onClick={() => setManualEnding(true)}>
                    Point Ended Another Way
                  </button>
                </div>

                {selectedTouchType && (
                  <div className="touch-player-picker">
                    <span>Who made the {selectedTouchType.toLowerCase()}?</span>

                    <div className="button-group">
                      {players
                        .filter(
                          (player) =>
                            getPlayerTeam(player.id) === hittingTeam
                        )
                        .map((player) => (
                          <button
                            key={player.id}
                            onClick={() =>
                              recordTouch(player.id)
                            }
                          >
                            {player.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {currentPointRally.length > 0 && (
                  <ul className="touch-list">
                    {currentPointRally.map((touch) => (
                      <li key={touch.id}>
                        <span>
                          {touch.type}
                          {touch.controlled === false ? " (lost)" : ""}
                          {" · "}
                          {getPlayerName(touch.playerId)}
                          {touch.timestamp !== null
                            ? ` · ${formatTime(touch.timestamp)}`
                            : ""}
                        </span>

                        <button
                          onClick={() =>
                            removeCurrentTouch(touch.id)
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* POINT WINNER (any other ending) */}

            {rallyStarted &&
              manualEnding &&
              !pendingWinningTeam && (
                <div className="control-section">
                  <h2>Point Winner</h2>

                  <div className="button-group">
                    <button
                      onClick={() =>
                        setPendingWinningTeam(
                          "Team 1"
                        )
                      }
                    >
                      {team1.join(" / ")}
                    </button>

                    <button
                      onClick={() =>
                        setPendingWinningTeam(
                          "Team 2"
                        )
                      }
                    >
                      {team2.join(" / ")}
                    </button>

                    <button onClick={() => setManualEnding(false)}>
                      Back to the Rally
                    </button>
                  </div>
                </div>
              )}

            {/* POINT OUTCOME */}

            {pendingWinningTeam &&
              !pendingOutcome && (
                <div className="control-section">
                  <h2>Point Outcome</h2>

                  <div className="button-group">
                    {RALLY_OUTCOMES.map((outcome) => (
                      <button
                        key={outcome.name}
                        onClick={() =>
                          setPendingOutcome(outcome.name)
                        }
                      >
                        {outcome.name}
                      </button>
                    ))}

                    <button
                      onClick={() =>
                        finishPoint(
                          pendingWinningTeam,
                          "Other"
                        )
                      }
                    >
                      Other
                    </button>
                  </div>
                </div>
              )}

            {/* VIOLATION TYPE */}

            {pendingOutcome === "Violation" &&
              !pendingViolationType && (
                <div className="control-section">
                  <h2>Which Violation?</h2>

                  <div className="button-group">
                    {VIOLATION_TYPES.map((violationType) => (
                      <button
                        key={violationType}
                        onClick={() =>
                          setPendingViolationType(violationType)
                        }
                      >
                        {violationType}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {/* RESPONSIBLE PLAYER */}

            {pendingOutcome &&
              (pendingOutcome !== "Violation" ||
                pendingViolationType) && (
                <div className="control-section">
                  <h2>
                    {pendingOutcome === "Kill"
                      ? "Who Got the Kill?"
                      : `Who Made the ${(pendingViolationType ?? pendingOutcome).toLowerCase()}?`}
                  </h2>

                  <div className="button-group">
                    {players
                      .filter((player) => {
                        const outcome = RALLY_OUTCOMES.find(
                          (rallyOutcome) =>
                            rallyOutcome.name === pendingOutcome
                        )

                        const team =
                          outcome.side === "winner"
                            ? pendingWinningTeam
                            : getOtherTeam(pendingWinningTeam)

                        return getPlayerTeam(player.id) === team
                      })
                      .map((player) => (
                        <button
                          key={player.id}
                          onClick={() =>
                            finishPoint(
                              pendingWinningTeam,
                              pendingOutcome,
                              player.id,
                              pendingViolationType
                            )
                          }
                        >
                          {player.name}
                        </button>
                      ))}

                    {pendingOutcome === "Violation" && (
                      <button
                        onClick={() =>
                          finishPoint(
                            pendingWinningTeam,
                            pendingOutcome,
                            null,
                            pendingViolationType
                          )
                        }
                      >
                        Whole Team
                      </button>
                    )}
                  </div>
                </div>
              )}
          </aside>
        </section>

        {/* HISTORY */}

        <section className="dashboard-grid">

          <div className="dashboard-card">
            <h2>Serve History</h2>

            {serves.length === 0 ? (
              <p className="empty-state">
                No serves recorded yet.
              </p>
            ) : (
              <div className="history-list">
                {serves.map((serve, index) => (
                  <div
                    className="history-item"
                    key={serve.id}
                  >
                    <button
                      className="history-jump-button"
                      onClick={() =>
                        jumpToTimestamp(serve.timestamp)
                      }
                    >
                      <strong>
                        #{index + 1} · {getPlayerName(serve.playerId)}
                        {serve.receiverId
                          ? ` → ${getPlayerName(serve.receiverId)}`
                          : ""}
                      </strong>

                      <span>
                        Serve {serve.serveAttempt} · {serve.hand} · {serve.type}
                      </span>

                      <span>
                        {formatTime(serve.timestamp)} · {serve.legality}
                      </span>
                    </button>

                    {editingServeId === serve.id ? (
                      <div className="serve-edit-controls">
                        <div className="serve-edit-group">
                          <span>Receiver</span>

                          <div className="button-group">
                            {getOpponentIds(serve.playerId).map(
                              (playerId) => (
                                <button
                                  key={playerId}
                                  className={
                                    editReceiverId === playerId
                                      ? "selected-button"
                                      : ""
                                  }
                                  onClick={() =>
                                    setEditReceiverId(
                                      editReceiverId === playerId
                                        ? null
                                        : playerId
                                    )
                                  }
                                >
                                  {getPlayerName(playerId)}
                                </button>
                              )
                            )}
                          </div>
                        </div>

                        <div className="serve-edit-group">
                          <span>Hand</span>

                          <div className="button-group">
                            <button
                              className={
                                editHand === "Left"
                                  ? "selected-button"
                                  : ""
                              }
                              onClick={() => setEditHand("Left")}
                            >
                              Left
                            </button>

                            <button
                              className={
                                editHand === "Right"
                                  ? "selected-button"
                                  : ""
                              }
                              onClick={() => setEditHand("Right")}
                            >
                              Right
                            </button>
                          </div>
                        </div>

                        <div className="serve-edit-group">
                          <span>Serve Type</span>

                          <div className="button-group">
                            {[
                              "Cut",
                              "Reverse",
                              "Jam",
                              "Drop",
                              "Tap-on"
                            ].map((type) => (
                              <button
                                key={type}
                                className={
                                  editServeType === type
                                    ? "selected-button"
                                    : ""
                                }
                                onClick={() =>
                                  setEditServeType(type)
                                }
                              >
                                {type}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="serve-edit-group">
                          <span>Legality</span>

                          <div className="button-group">
                            <button
                              className={
                                editServeStatus === "Legal"
                                  ? "selected-button"
                                  : ""
                              }
                              onClick={() => {
                                setEditServeStatus("Legal")
                                setEditFaultType(null)
                                setEditPlayedThrough(null)
                                setEditServeResult(null)
                              }}
                            >
                              Legal
                            </button>

                            <button
                              className={
                                editServeStatus === "Fault"
                                  ? "selected-button"
                                  : ""
                              }
                              onClick={() => {
                                setEditServeStatus("Fault")
                                setEditFaultType(null)
                                setEditPlayedThrough(null)
                                setEditServeResult("Fault")
                              }}
                            >
                              Fault
                            </button>
                          </div>
                        </div>

                        {editServeStatus === "Fault" && (
                          <div className="serve-edit-group">
                            <span>Fault Type</span>

                            <div className="button-group">
                              {SERVE_FAULT_TYPES.map((faultType) => (
                                <button
                                  key={faultType}
                                  className={
                                    editFaultType === faultType
                                      ? "selected-button"
                                      : ""
                                  }
                                  onClick={() => {
                                    setEditFaultType(faultType)
                                    setEditPlayedThrough(
                                      NO_PLAY_THROUGH_FAULTS.includes(faultType)
                                        ? false
                                        : null
                                    )
                                  }}
                                >
                                  {faultType}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {editServeStatus === "Fault" &&
                          editFaultType &&
                          !NO_PLAY_THROUGH_FAULTS.includes(editFaultType) && (
                            <div className="serve-edit-group">
                              <span>Played Through?</span>

                              <div className="button-group">
                                <button
                                  className={
                                    editPlayedThrough === true
                                      ? "selected-button"
                                      : ""
                                  }
                                  onClick={() =>
                                    setEditPlayedThrough(true)
                                  }
                                >
                                  Yes
                                </button>

                                <button
                                  className={
                                    editPlayedThrough === false
                                      ? "selected-button"
                                      : ""
                                  }
                                  onClick={() =>
                                    setEditPlayedThrough(false)
                                  }
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          )}

                        {editServeStatus === "Legal" && (
                          <div className="serve-edit-group">
                            <span>Result</span>

                            <div className="button-group">
                              <button
                                className={
                                  editServeResult === "Ace"
                                    ? "selected-button"
                                    : ""
                                }
                                onClick={() =>
                                  setEditServeResult("Ace")
                                }
                              >
                                Ace
                              </button>

                              <button
                                className={
                                  editServeResult === "Returned"
                                    ? "selected-button"
                                    : ""
                                }
                                onClick={() =>
                                  setEditServeResult("Returned")
                                }
                              >
                                Returned
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="serve-edit-actions">
                          <button onClick={cancelServeEdit}>
                            Cancel
                          </button>

                          <button
                            className="save-edit-button"
                            onClick={saveServeEdit}
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="history-item-actions">
                        <button
                          className="edit-serve-button"
                          onClick={() =>
                            startEditingServe(serve)
                          }
                        >
                          Edit
                        </button>

                        <button
                          className="edit-serve-button delete-button"
                          onClick={() => deleteServe(serve)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="dashboard-card">
            <h2>Points</h2>

            {points.length === 0 ? (
              <p className="empty-state">
                No completed points yet.
              </p>
            ) : (
              <div className="point-list">
                {points.map((point, index) => (
                  <div
                    className="point-item"
                    key={point.id}
                  >
                    <strong>
                      Point {index + 1} · Game {point.gameNumber ?? 1}
                      {" · "}
                      {runningScores[index]["Team 1"]}–{runningScores[index]["Team 2"]}
                    </strong>

                    <span>
                      Server:{" "}
                      {getPlayerName(point.serverId)}
                    </span>

                    <span>
                      Winner: {point.winningTeam}
                    </span>

                    <span>
                      {point.outcome}

                      {point.violationType
                        ? ` (${point.violationType})`
                        : ""}

                      {point.responsiblePlayerId
                        ? ` · ${getPlayerName(
                          point.responsiblePlayerId
                        )}`
                        : ""}
                    </span>

                    {(point.rally ?? []).length > 0 && (
                      <span>
                        {summarizeRally(point.rally)}
                      </span>
                    )}

                    {editingPointId === point.id ? (
                      <div className="point-edit-controls">

                        <div className="point-edit-group">
                          <span>Winner</span>

                          <div className="button-group">
                            <button
                              className={
                                editWinningTeam === "Team 1"
                                  ? "selected-button"
                                  : ""
                              }
                              onClick={() => {
                                setEditWinningTeam("Team 1")
                                setEditResponsiblePlayerId(null)
                              }}
                            >
                              Team 1
                            </button>

                            <button
                              className={
                                editWinningTeam === "Team 2"
                                  ? "selected-button"
                                  : ""
                              }
                              onClick={() => {
                                setEditWinningTeam("Team 2")
                                setEditResponsiblePlayerId(null)
                              }}
                            >
                              Team 2
                            </button>
                          </div>
                        </div>

                        <div className="point-edit-group">
                          <span>Outcome</span>

                          <div className="button-group">
                            {[
                              ...RALLY_OUTCOMES.map((outcome) => outcome.name),
                              "Other"
                            ].map((outcomeName) => (
                              <button
                                key={outcomeName}
                                className={
                                  editPointOutcome === outcomeName
                                    ? "selected-button"
                                    : ""
                                }
                                onClick={() => {
                                  setEditPointOutcome(outcomeName)
                                  setEditResponsiblePlayerId(null)
                                }}
                              >
                                {outcomeName}
                              </button>
                            ))}
                          </div>
                        </div>

                        {editPointOutcome === "Violation" && (
                          <div className="point-edit-group">
                            <span>Violation</span>

                            <div className="button-group">
                              {VIOLATION_TYPES.map((violationType) => (
                                <button
                                  key={violationType}
                                  className={
                                    editViolationType === violationType
                                      ? "selected-button"
                                      : ""
                                  }
                                  onClick={() =>
                                    setEditViolationType(violationType)
                                  }
                                >
                                  {violationType}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {RALLY_OUTCOMES.some(
                          (outcome) => outcome.name === editPointOutcome
                        ) && (
                          <div className="point-edit-group">
                            <span>Responsible player</span>

                            <div className="button-group">
                              {players
                                .filter((player) => {
                                  const outcome = RALLY_OUTCOMES.find(
                                    (rallyOutcome) =>
                                      rallyOutcome.name === editPointOutcome
                                  )

                                  const team =
                                    outcome.side === "winner"
                                      ? editWinningTeam
                                      : getOtherTeam(editWinningTeam)

                                  return getPlayerTeam(player.id) === team
                                })
                                .map((player) => (
                                  <button
                                    key={player.id}
                                    className={
                                      editResponsiblePlayerId === player.id
                                        ? "selected-button"
                                        : ""
                                    }
                                    onClick={() =>
                                      setEditResponsiblePlayerId(
                                        player.id
                                      )
                                    }
                                  >
                                    {player.name}
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}

                        {editRally.length > 0 && (
                          <div className="point-edit-group">
                            <span>Rally Touches</span>

                            <ul className="touch-list">
                              {editRally.map((touch) => (
                                <li key={touch.id}>
                                  <span>
                                    {touch.type}
                                    {touch.controlled === false ? " (lost)" : ""}
                                    {" · "}
                                    {getPlayerName(touch.playerId)}
                                  </span>

                                  <button
                                    onClick={() =>
                                      setEditRally(
                                        editRally.filter(
                                          (editTouch) =>
                                            editTouch.id !== touch.id
                                        )
                                      )
                                    }
                                  >
                                    Remove
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="point-edit-actions">
                          <button
                            onClick={cancelPointEdit}
                          >
                            Cancel
                          </button>

                          <button
                            className="save-edit-button"
                            onClick={savePointEdit}
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="history-item-actions">
                        <button
                          className="edit-point-button"
                          onClick={() =>
                            startEditingPoint(point)
                          }
                        >
                          Edit
                        </button>

                        <button
                          className="edit-point-button delete-button"
                          onClick={() => deletePoint(point)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* STATISTICS */}

        <section className="stats-section">

          <div className="stats-header">
            <h2>Match Statistics</h2>
          </div>

          <div className="stat-card-grid">

            <div className="stat-card">
              <span>Total Serves</span>
              <strong>{totalServes}</strong>
            </div>

            <div className="stat-card">
              <span>Legal Serves</span>
              <strong>
                {percentage(
                  legalServes,
                  totalServes
                )}
                %
              </strong>
            </div>

            <div className="stat-card">
              <span>Faults</span>
              <strong>
                {percentage(
                  faultServes,
                  totalServes
                )}
                %
              </strong>
            </div>

            <div className="stat-card">
              <span>Aces</span>
              <strong>{aces}</strong>
            </div>

            <div className="stat-card">
              <span>Double Faults</span>
              <strong>
                {doubleFaults}
              </strong>
            </div>

            <div className="stat-card">
              <span>1st Serve Legal</span>
              <strong>
                {percentage(
                  firstServeLegal,
                  firstServes.length
                )}
                %
              </strong>
            </div>

            <div className="stat-card">
              <span>2nd Serve Legal</span>
              <strong>
                {percentage(
                  secondServeLegal,
                  secondServes.length
                )}
                %
              </strong>
            </div>
          </div>

          {/* TEAM STATISTICS */}

          <div className="stats-subsection">
            <h2>Team Statistics</h2>

            <div className="team-stat-grid">
              {teamStats.map((stats) => {
                const teamLabel =
                  stats.teamName === "Team 1"
                    ? team1.join(" / ")
                    : team2.join(" / ")

                return (
                  <div
                    className="team-stat-card"
                    key={stats.teamName}
                  >
                    <div className="player-card-header">
                      <h3>{teamLabel}</h3>

                      <button
                        onClick={() =>
                          setExpandedTeam(
                            expandedTeam === stats.teamName
                              ? null
                              : stats.teamName
                          )
                        }
                      >
                        {expandedTeam === stats.teamName
                          ? "Hide Details"
                          : "View Details"}
                      </button>
                    </div>

                    {/* OVERVIEW */}

                    <div className="stat-row">
                      <span>Points Won</span>
                      <strong>
                        {stats.pointsWon}
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>Hold %</span>
                      <strong>
                        {percentage(
                          stats.receivingPointsWon,
                          stats.receivingPoints
                        )}
                        %
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>Break %</span>
                      <strong>
                        {percentage(
                          stats.servingPointsWon,
                          stats.servingPoints
                        )}
                        %
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>Aces</span>
                      <strong>
                        {stats.aces}
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>Double Faults</span>
                      <strong>
                        {stats.doubleFaults}
                      </strong>
                    </div>

                    {/* DETAILS */}

                    {expandedTeam === stats.teamName && (
                      <div className="team-details">

                        {stats.servingPoints > 0 && (
                          <>
                            <div className="stat-divider" />

                            <h4>Serving Details</h4>

                            <div className="stat-row">
                              <span>Serving Points</span>
                              <strong>
                                {stats.servingPoints}
                              </strong>
                            </div>

                            <div className="stat-row">
                              <span>Serving Points Won</span>
                              <strong>
                                {stats.servingPointsWon}
                              </strong>
                            </div>
                          </>
                        )}

                        {stats.receivingPoints > 0 && (
                          <>
                            <div className="stat-divider" />

                            <h4>Receiving Details</h4>

                            <div className="stat-row">
                              <span>Receiving Points</span>
                              <strong>
                                {stats.receivingPoints}
                              </strong>
                            </div>

                            <div className="stat-row">
                              <span>Receiving Points Won</span>
                              <strong>
                                {stats.receivingPointsWon}
                              </strong>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* PLAYER STATISTICS */}

          <div className="stats-subsection">
            <h2>Player Statistics</h2>

            {playerStats.length === 0 ? (
              <p className="empty-state">
                Player statistics will appear
                after events are recorded.
              </p>
            ) : (
              <div className="player-stat-grid">

                {playerStats.map((stats) => (
                  <div
                    className="player-stat-card"
                    key={stats.playerId}
                  >

                    <div className="player-card-header">

                      <h3>
                        {stats.playerName}
                      </h3>

                      <button
                        onClick={() =>
                          setExpandedPlayerId(
                            expandedPlayerId ===
                              stats.playerId
                              ? null
                              : stats.playerId
                          )
                        }
                      >
                        {expandedPlayerId ===
                          stats.playerId
                          ? "Hide Details"
                          : "View Details"}
                      </button>

                    </div>

                    {/* OVERVIEW */}

                    <div className="stat-row">
                      <span>Total Serves</span>
                      <strong>
                        {stats.totalServes}
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>
                        Legal Serve %
                      </span>
                      <strong>
                        {percentage(
                          stats.legal,
                          stats.totalServes
                        )}
                        %
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>Aces</span>
                      <strong>
                        {stats.aces}
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>Kills</span>
                      <strong>
                        {stats.kills}
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>
                        Offensive Errors
                      </span>
                      <strong>
                        {stats.offensiveErrors}
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>
                        Serving Point Win %
                      </span>
                      <strong>
                        {percentage(
                          stats.servingWins,
                          stats.pointsServed
                        )}
                        %
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>
                        Defensive Touches
                      </span>
                      <strong>
                        {stats.defensiveTouches}
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>Far Sets</span>
                      <strong>
                        {stats.farSets}
                      </strong>
                    </div>

                    <div className="stat-row">
                      <span>Times Aced</span>
                      <strong>
                        {stats.timesAced}
                      </strong>
                    </div>

                    {/* DETAILS */}

                    {expandedPlayerId ===
                      stats.playerId && (
                        <div className="player-details">

                          {/* SERVING DETAILS */}

                          {stats.totalServes > 0 && (
                            <>
                              <div className="stat-divider" />

                              <h4>
                                Serving Details
                              </h4>

                              <div className="stat-row">
                                <span>
                                  Fault %
                                </span>
                                <strong>
                                  {percentage(
                                    stats.faults,
                                    stats.totalServes
                                  )}
                                  %
                                </strong>
                              </div>

                              <div className="stat-row">
                                <span>
                                  Double Faults
                                </span>
                                <strong>
                                  {stats.doubleFaults}
                                </strong>
                              </div>

                              <div className="stat-row">
                                <span>
                                  1st Serve Legal %
                                </span>
                                <strong>
                                  {percentage(
                                    stats.firstServeLegal,
                                    stats.firstServes
                                  )}
                                  %
                                </strong>
                              </div>

                              <div className="stat-row">
                                <span>
                                  2nd Serve Legal %
                                </span>
                                <strong>
                                  {percentage(
                                    stats.secondServeLegal,
                                    stats.secondServes
                                  )}
                                  %
                                </strong>
                              </div>
                            </>
                          )}

                          {/* POINT STATISTICS */}

                          {stats.pointsServed > 0 && (
                            <>
                              <div className="stat-divider" />

                              <h4>
                                Point Statistics
                              </h4>

                              <div className="stat-row">
                                <span>
                                  Points Served
                                </span>
                                <strong>
                                  {stats.pointsServed}
                                </strong>
                              </div>

                              <div className="stat-row">
                                <span>
                                  Points Won Serving
                                </span>
                                <strong>
                                  {stats.servingWins}
                                </strong>
                              </div>

                              <div className="stat-row">
                                <span>
                                  Serving Point Win %
                                </span>
                                <strong>
                                  {percentage(
                                    stats.servingWins,
                                    stats.pointsServed
                                  )}
                                  %
                                </strong>
                              </div>

                              {stats.firstServePoints >
                                0 && (
                                  <div className="stat-row">
                                    <span>
                                      1st-Serve Point Win %
                                    </span>
                                    <strong>
                                      {percentage(
                                        stats.firstServePointWins,
                                        stats.firstServePoints
                                      )}
                                      %
                                    </strong>
                                  </div>
                                )}

                              {stats.secondServePoints >
                                0 && (
                                  <div className="stat-row">
                                    <span>
                                      2nd-Serve Point Win %
                                    </span>
                                    <strong>
                                      {percentage(
                                        stats.secondServePointWins,
                                        stats.secondServePoints
                                      )}
                                      %
                                    </strong>
                                  </div>
                                )}
                            </>
                          )}

                          {/* ERRORS */}

                          {stats.defensiveErrors +
                            stats.receiveErrors +
                            stats.violations >
                            0 && (
                              <>
                                <div className="stat-divider" />

                                <h4>Errors</h4>

                                <div className="stat-row">
                                  <span>Defensive Errors</span>
                                  <strong>
                                    {stats.defensiveErrors}
                                  </strong>
                                </div>

                                <div className="stat-row">
                                  <span>Receive Errors</span>
                                  <strong>
                                    {stats.receiveErrors}
                                  </strong>
                                </div>

                                <div className="stat-row">
                                  <span>Violations</span>
                                  <strong>
                                    {stats.violations}
                                  </strong>
                                </div>
                              </>
                            )}

                          {/* RALLY DETAILS */}

                          {stats.hits +
                            stats.defensiveTouches +
                            stats.sets +
                            stats.farSets >
                            0 && (
                              <>
                                <div className="stat-divider" />

                                <h4>
                                  Rally Details
                                </h4>

                                <div className="stat-row">
                                  <span>Hits</span>
                                  <strong>
                                    {stats.hits}
                                  </strong>
                                </div>

                                {stats.hits > 0 && (
                                  <div className="stat-row">
                                    <span>
                                      Hitting Efficiency
                                    </span>
                                    <strong>
                                      {percentage(
                                        stats.kills -
                                          stats.offensiveErrors,
                                        stats.hits
                                      )}
                                      %
                                    </strong>
                                  </div>
                                )}

                                <div className="stat-row">
                                  <span>
                                    Defensive Touches
                                  </span>
                                  <strong>
                                    {stats.defensiveTouches}
                                  </strong>
                                </div>

                                {stats.defensiveTouches > 0 && (
                                  <div className="stat-row">
                                    <span>
                                      Defensive Touches Kept Up
                                    </span>
                                    <strong>
                                      {percentage(
                                        stats.defensiveTouches -
                                          stats.lostDefensiveTouches,
                                        stats.defensiveTouches
                                      )}
                                      %
                                    </strong>
                                  </div>
                                )}

                                <div className="stat-row">
                                  <span>Sets</span>
                                  <strong>
                                    {stats.sets}
                                  </strong>
                                </div>

                                <div className="stat-row">
                                  <span>Far Sets</span>
                                  <strong>
                                    {stats.farSets}
                                  </strong>
                                </div>

                                <div className="stat-row">
                                  <span>
                                    Far Set %
                                  </span>
                                  <strong>
                                    {percentage(
                                      stats.farSets,
                                      stats.sets + stats.farSets
                                    )}
                                    %
                                  </strong>
                                </div>
                              </>
                            )}

                          {/* RECEIVING DETAILS */}

                          {stats.servesReceived > 0 && (
                            <>
                              <div className="stat-divider" />

                              <h4>
                                Receiving Details
                              </h4>

                              <div className="stat-row">
                                <span>
                                  Legal Serves Received
                                </span>
                                <strong>
                                  {stats.legalServesReceived}
                                </strong>
                              </div>

                              <div className="stat-row">
                                <span>Times Aced</span>
                                <strong>
                                  {stats.timesAced}
                                </strong>
                              </div>

                              <div className="stat-row">
                                <span>
                                  Aced %
                                </span>
                                <strong>
                                  {percentage(
                                    stats.timesAced,
                                    stats.legalServesReceived
                                  )}
                                  %
                                </strong>
                              </div>

                              {Object.entries(
                                stats.acedByServer
                              ).map(([serverId, count]) => (
                                <div
                                  className="stat-row"
                                  key={serverId}
                                >
                                  <span>
                                    Aced by {getPlayerName(serverId)}
                                  </span>
                                  <strong>{count}</strong>
                                </div>
                              ))}
                            </>
                          )}

                          {/* ACES BY RECEIVER */}

                          {Object.keys(stats.acesByReceiver)
                            .length > 0 && (
                              <>
                                <div className="stat-divider" />

                                <h4>
                                  Aces by Receiver
                                </h4>

                                {Object.entries(
                                  stats.acesByReceiver
                                ).map(([receiverId, count]) => (
                                  <div
                                    className="stat-row"
                                    key={receiverId}
                                  >
                                    <span>
                                      Aced {getPlayerName(receiverId)}
                                    </span>
                                    <strong>{count}</strong>
                                  </div>
                                ))}
                              </>
                            )}

                          {/* SERVE BREAKDOWN */}

                          {stats.totalServes > 0 && (
                            <>
                              <div className="stat-divider" />

                              <h4>
                                Serve Breakdown
                              </h4>

                              {Object.entries(
                                stats.serveBreakdown
                              ).map(
                                ([
                                  serveName,
                                  serveStats
                                ]) => (
                                  <div
                                    className="breakdown-card"
                                    key={serveName}
                                  >
                                    <strong>
                                      {serveName}
                                    </strong>

                                    <span>
                                      Attempts:{" "}
                                      {
                                        serveStats.attempts
                                      }
                                    </span>

                                    <span>
                                      Legal:{" "}
                                      {percentage(
                                        serveStats.legal,
                                        serveStats.attempts
                                      )}
                                      %
                                    </span>

                                    <span>
                                      Faults:{" "}
                                      {percentage(
                                        serveStats.faults,
                                        serveStats.attempts
                                      )}
                                      %
                                    </span>

                                    <span>
                                      Aces:{" "}
                                      {
                                        serveStats.aces
                                      }
                                    </span>

                                    <span>
                                      Ace Rate:{" "}
                                      {percentage(
                                        serveStats.aces,
                                        serveStats.attempts
                                      )}
                                      %
                                    </span>
                                  </div>
                                )
                              )}
                            </>
                          )}

                          {/* FAULT BREAKDOWN */}

                          {stats.faults > 0 && (
                            <>
                              <div className="stat-divider" />

                              <h4>
                                Fault Breakdown
                              </h4>

                              {Object.entries(
                                stats.faultBreakdown
                              )
                                .filter(
                                  ([, count]) =>
                                    count > 0
                                )
                                .map(
                                  ([
                                    faultType,
                                    count
                                  ]) => (
                                    <div
                                      className="breakdown-card"
                                      key={faultType}
                                    >
                                      <strong>
                                        {faultType}
                                      </strong>

                                      <span>
                                        Count:{" "}
                                        {count}
                                      </span>

                                      <span>
                                        Share of Faults:{" "}
                                        {percentage(
                                          count,
                                          stats.faults
                                        )}
                                        %
                                      </span>
                                    </div>
                                  )
                                )}
                            </>
                          )}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App