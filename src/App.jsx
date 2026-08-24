import { useRef, useState } from "react"
import "./App.css"

function App() {
  const videoRef = useRef(null)

  const [videoURL, setVideoURL] = useState(null)
  const [serves, setServes] = useState([])

  const [players, setPlayers] = useState([
    { id: "player-1", name: "Player 1" },
    { id: "player-2", name: "Player 2" },
    { id: "player-3", name: "Player 3" },
    { id: "player-4", name: "Player 4" }
  ])

  const [selectedPlayerId, setSelectedPlayerId] = useState(null)

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

  const [points, setPoints] = useState([])
  const [currentPointServes, setCurrentPointServes] = useState([])

  const [pendingWinningTeam, setPendingWinningTeam] = useState(null)
  const [pendingOutcome, setPendingOutcome] = useState(null)

  const [expandedPlayerId, setExpandedPlayerId] = useState(null)
  const [expandedTeam, setExpandedTeam] = useState(null)

  const currentPointServerId =
    currentPointServes.length > 0
      ? currentPointServes[0].playerId
      : null

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

      setServes([])
      setPoints([])
      setCurrentPointServes([])

      setServeStatus(null)
      setSelectedFaultType(null)

      setPendingWinningTeam(null)
      setPendingOutcome(null)

      setSelectedPlayerId(null)
      setSelectedHand("None")
      setSelectedServeType("None")

      setExpandedPlayerId(null)
    }
  }

  function markServe(
    result,
    faultType = null,
    playedThrough = null
  ) {
    if (
      selectedPlayerId === null ||
      selectedHand === "None" ||
      selectedServeType === "None"
    ) {
      alert("Select a server, hand, and serve type first.")
      return
    }

    const currentTime = videoRef.current.currentTime
    const serveAttempt = currentPointServes.length + 1

    const newServe = {
      id: crypto.randomUUID(),
      timestamp: currentTime,
      playerId: selectedPlayerId,
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
      getPlayerTeam(selectedPlayerId)

    // ACE
    if (result === "Ace") {
      const newPoint = {
        id: crypto.randomUUID(),
        serverId: selectedPlayerId,
        serves: updatedPointServes,
        winningTeam: servingTeam,
        outcome: "Ace",
        responsiblePlayerId: null
      }

      setPoints([
        ...points,
        newPoint
      ])

      setCurrentPointServes([])

      setPendingWinningTeam(null)
      setPendingOutcome(null)

      setSelectedPlayerId(null)
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
        serverId: selectedPlayerId,
        serves: updatedPointServes,
        winningTeam: receivingTeam,
        outcome: "Double Fault",
        responsiblePlayerId: null
      }

      setPoints([
        ...points,
        newPoint
      ])

      setCurrentPointServes([])

      setPendingWinningTeam(null)
      setPendingOutcome(null)

      setSelectedPlayerId(null)
      setSelectedHand("None")
      setSelectedServeType("None")
    }
  }

  function finishPoint(
    winningTeam,
    outcome,
    responsiblePlayerId = null
  ) {
    if (currentPointServes.length === 0) {
      return
    }

    const newPoint = {
      id: crypto.randomUUID(),
      serverId: currentPointServes[0].playerId,
      serves: currentPointServes,
      winningTeam,
      outcome,
      responsiblePlayerId
    }

    setPoints([
      ...points,
      newPoint
    ])

    setCurrentPointServes([])

    setPendingWinningTeam(null)
    setPendingOutcome(null)

    setSelectedPlayerId(null)
    setSelectedHand("None")
    setSelectedServeType("None")

    setServeStatus(null)
    setSelectedFaultType(null)
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

  // -----------------------------
  // Match statistics
  // -----------------------------

  const totalServes = serves.length

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
      const faultBreakdown = {
        Rim: 0,
        High: 0,
        Pocket: 0,
        "Missed Net": 0
      }

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
        offensiveErrors: playerOffensiveErrors
      }
    })
    .filter(
      (stats) =>
        stats.totalServes > 0 ||
        stats.kills > 0 ||
        stats.offensiveErrors > 0
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
          <label className="upload-label">
            Match Video
          </label>

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
                Upload a match to begin analyzing.
              </div>
            )}
          </div>

          <aside className="controls-panel">

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
                      setSelectedPlayerId(
                        player.id
                      )
                    }
                    disabled={
                      currentPointServerId !== null &&
                      currentPointServerId !==
                      player.id
                    }
                    className={
                      selectedPlayerId === player.id
                        ? "selected-button"
                        : ""
                    }
                  >
                    {player.name}
                  </button>
                ))}
              </div>
            </div>

            {/* HAND */}

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

            {/* SERVE TYPE */}

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

            {/* SERVE LEGALITY */}

            {videoURL && (
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
                  <button
                    className={
                      selectedFaultType === "Rim"
                        ? "selected-button"
                        : ""
                    }
                    onClick={() =>
                      setSelectedFaultType("Rim")
                    }
                  >
                    Rim
                  </button>

                  <button
                    className={
                      selectedFaultType === "High"
                        ? "selected-button"
                        : ""
                    }
                    onClick={() =>
                      setSelectedFaultType("High")
                    }
                  >
                    High
                  </button>

                  <button
                    className={
                      selectedFaultType === "Pocket"
                        ? "selected-button"
                        : ""
                    }
                    onClick={() =>
                      setSelectedFaultType("Pocket")
                    }
                  >
                    Pocket
                  </button>

                  <button
                    onClick={() =>
                      markServe(
                        "Fault",
                        "Missed Net",
                        false
                      )
                    }
                  >
                    Missed Net
                  </button>
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

            {/* POINT WINNER */}

            {rallyStarted &&
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
                  </div>
                </div>
              )}

            {/* POINT OUTCOME */}

            {pendingWinningTeam &&
              !pendingOutcome && (
                <div className="control-section">
                  <h2>Point Outcome</h2>

                  <div className="button-group">
                    <button
                      onClick={() =>
                        setPendingOutcome("Kill")
                      }
                    >
                      Kill
                    </button>

                    <button
                      onClick={() =>
                        setPendingOutcome(
                          "Offensive Error"
                        )
                      }
                    >
                      Offensive Error
                    </button>

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

            {/* KILL ATTRIBUTION */}

            {pendingOutcome === "Kill" && (
              <div className="control-section">
                <h2>Who Got the Kill?</h2>

                <div className="button-group">
                  {players
                    .filter(
                      (player) =>
                        getPlayerTeam(
                          player.id
                        ) ===
                        pendingWinningTeam
                    )
                    .map((player) => (
                      <button
                        key={player.id}
                        onClick={() =>
                          finishPoint(
                            pendingWinningTeam,
                            "Kill",
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

            {/* OFFENSIVE ERROR ATTRIBUTION */}

            {pendingOutcome ===
              "Offensive Error" && (
                <div className="control-section">
                  <h2>
                    Who Made the Offensive Error?
                  </h2>

                  <div className="button-group">
                    {players
                      .filter(
                        (player) =>
                          getPlayerTeam(
                            player.id
                          ) !==
                          pendingWinningTeam
                      )
                      .map((player) => (
                        <button
                          key={player.id}
                          onClick={() =>
                            finishPoint(
                              pendingWinningTeam,
                              "Offensive Error",
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
                  <button
                    className="history-item"
                    key={serve.id}
                    onClick={() =>
                      jumpToTimestamp(
                        serve.timestamp
                      )
                    }
                  >
                    <strong>
                      #{index + 1} ·{" "}
                      {getPlayerName(
                        serve.playerId
                      )}
                    </strong>

                    <span>
                      Serve {serve.serveAttempt} ·{" "}
                      {serve.hand} · {serve.type}
                    </span>

                    <span>
                      {formatTime(serve.timestamp)} ·{" "}
                      {serve.legality}

                      {serve.faultType
                        ? ` (${serve.faultType})`
                        : ""}

                      {serve.playedThrough === true
                        ? " · Played Through"
                        : ""}

                      {serve.playedThrough === false
                        ? " · Not Played"
                        : ""}

                      {serve.result &&
                        serve.result !== "Fault"
                        ? ` · ${serve.result}`
                        : ""}
                    </span>
                  </button>
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
                      Point {index + 1}
                    </strong>

                    <span>
                      Server:{" "}
                      {getPlayerName(
                        point.serverId
                      )}
                    </span>

                    <span>
                      Winner:{" "}
                      {point.winningTeam}
                    </span>

                    <span>
                      {point.outcome}

                      {point.responsiblePlayerId
                        ? ` · ${getPlayerName(
                          point.responsiblePlayerId
                        )}`
                        : ""}
                    </span>
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