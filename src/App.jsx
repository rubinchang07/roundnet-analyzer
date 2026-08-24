import { useRef, useState } from "react"

function App() {
  const videoRef = useRef(null)

  const [videoURL, setVideoURL] = useState(null)
  const [serves, setServes] = useState([])
  const [selectedPlayer, setSelectedPlayer] = useState("None")
  const [players, setPlayers] = useState([
    "Player 1",
    "Player 2",
    "Player 3",
    "Player 4"
  ])

  const teams = [
    [0, 1],
    [2, 3]
  ]

  const team1 = teams[0].map((index) => players[index])
  const team2 = teams[1].map((index) => players[index])

  const [selectedServeType, setSelectedServeType] = useState("None")
  const [serveStatus, setServeStatus] = useState(null)
  const [selectedFaultType, setSelectedFaultType] = useState(null)
  const [selectedHand, setSelectedHand] = useState("None")

  const [points, setPoints] = useState([])
  const [currentPointServes, setCurrentPointServes] = useState([])
  const [pendingWinningTeam, setPendingWinningTeam] = useState(null)

  const currentPointServer =
    currentPointServes.length > 0
      ? currentPointServes[0].player
      : null

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
      setSelectedPlayer("None")
      setSelectedHand("None")
      setSelectedServeType("None")
    }
  }

  function getPlayerTeam(player) {
    const playerIndex = players.indexOf(player)

    if (teams[0].includes(playerIndex)) {
      return "Team 1"
    }

    if (teams[1].includes(playerIndex)) {
      return "Team 2"
    }

    return null
  }

  function markServe(result, faultType = null, playedThrough = null) {
    if (
      selectedPlayer === "None" ||
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
      player: selectedPlayer,
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

    // After a fault, keep the same server but
    // reset hand and serve type for the next attempt.
    if (serveStatus === "Fault") {
      setSelectedHand("None")
      setSelectedServeType("None")
    }

    const servingTeam = getPlayerTeam(selectedPlayer)

    // ACE: serving team automatically wins.
    if (result === "Ace") {
      const newPoint = {
        id: crypto.randomUUID(),
        server: selectedPlayer,
        serves: updatedPointServes,
        winningTeam: servingTeam,
        outcome: "Ace"
      }

      setPoints([
        ...points,
        newPoint
      ])

      setCurrentPointServes([])
      setPendingWinningTeam(null)

      setSelectedPlayer("None")
      setSelectedHand("None")
      setSelectedServeType("None")

      return
    }

    // DOUBLE FAULT: receiving team automatically wins.
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
        server: selectedPlayer,
        serves: updatedPointServes,
        winningTeam: receivingTeam,
        outcome: "Double Fault"
      }

      setPoints([
        ...points,
        newPoint
      ])

      setCurrentPointServes([])
      setPendingWinningTeam(null)

      setSelectedPlayer("None")
      setSelectedHand("None")
      setSelectedServeType("None")
    }
  }

  function finishPoint(winningTeam, outcome) {
    if (currentPointServes.length === 0) {
      return
    }

    const newPoint = {
      id: crypto.randomUUID(),
      server: currentPointServes[0].player,
      serves: currentPointServes,
      winningTeam,
      outcome
    }

    setPoints([
      ...points,
      newPoint
    ])

    setCurrentPointServes([])
    setPendingWinningTeam(null)

    setSelectedPlayer("None")
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
    const updatedPlayers = [...players]

    updatedPlayers[index] = newName
    setPlayers(updatedPlayers)

    if (selectedPlayer === players[index]) {
      setSelectedPlayer(newName)
    }
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
        (serve) => serve.player === player
      )

      const legal = playerServes.filter(
        (serve) => serve.legality === "Legal"
      ).length

      const faults = playerServes.filter(
        (serve) => serve.legality === "Fault"
      ).length

      const playerAces = playerServes.filter(
        (serve) => serve.result === "Ace"
      ).length

      const playerFirstServes = playerServes.filter(
        (serve) => serve.serveAttempt === 1
      )

      const playerFirstServeLegal =
        playerFirstServes.filter(
          (serve) => serve.legality === "Legal"
        ).length

      const playerSecondServes = playerServes.filter(
        (serve) => serve.serveAttempt === 2
      )

      const playerSecondServeLegal =
        playerSecondServes.filter(
          (serve) => serve.legality === "Legal"
        ).length

      const playerDoubleFaults = points.filter(
        (point) =>
          point.server === player &&
          point.outcome === "Double Fault"
      ).length

      // Serve breakdown by hand + serve type
      const serveBreakdown = {}

      playerServes.forEach((serve) => {
        const key = `${serve.hand} ${serve.type}`

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

      // Fault breakdown by fault type
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
      const playerTeam = getPlayerTeam(player)

      const playerPointsServed = points.filter(
        (point) => point.server === player
      )

      const playerServingWins =
        playerPointsServed.filter(
          (point) =>
            point.winningTeam === playerTeam
        ).length

      const firstServePoints =
        playerPointsServed.filter(
          (point) => point.serves.length === 1
        )

      const firstServePointWins =
        firstServePoints.filter(
          (point) =>
            point.winningTeam === playerTeam
        ).length

      const secondServePoints =
        playerPointsServed.filter(
          (point) => point.serves.length === 2
        )

      const secondServePointWins =
        secondServePoints.filter(
          (point) =>
            point.winningTeam === playerTeam
        ).length

      const acePoints =
        playerPointsServed.filter(
          (point) => point.outcome === "Ace"
        ).length

      const doubleFaultPoints =
        playerPointsServed.filter(
          (point) => point.outcome === "Double Fault"
        ).length

      return {
        player,
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

        acePoints,
        doubleFaultPoints
      }
    })
    .filter((stats) => stats.totalServes > 0)

  return (
    <div>
      <h1>Roundnet Analyzer</h1>

      <p>
        Upload a match to begin analyzing your game.
      </p>

      <input
        type="file"
        accept="video/*"
        onChange={handleVideoUpload}
      />

      <div>
        <h2>Players</h2>

        {players.map((player, index) => (
          <div key={index}>
            <input
              type="text"
              value={player}
              onChange={(event) =>
                updatePlayerName(
                  index,
                  event.target.value
                )
              }
            />
          </div>
        ))}

        <div>
          <h2>Teams</h2>

          <p>
            Team 1: {team1.join(" / ")}
          </p>

          <p>
            Team 2: {team2.join(" / ")}
          </p>
        </div>

        <h2>Select Server</h2>

        {players.map((player, index) => (
          <button
            key={index}
            onClick={() =>
              setSelectedPlayer(player)
            }
            disabled={
              currentPointServer !== null &&
              currentPointServer !== player
            }
          >
            {player}
          </button>
        ))}

        <p>
          Selected: {selectedPlayer}
        </p>

        <div>
          <h2>Select Hand</h2>

          <button
            onClick={() =>
              setSelectedHand("Left")
            }
          >
            Left
          </button>

          <button
            onClick={() =>
              setSelectedHand("Right")
            }
          >
            Right
          </button>

          <p>
            Selected hand: {selectedHand}
          </p>
        </div>

        <div>
          <h2>Select Serve Type</h2>

          <button
            onClick={() =>
              setSelectedServeType("Cut")
            }
          >
            Cut
          </button>

          <button
            onClick={() =>
              setSelectedServeType("Reverse")
            }
          >
            Reverse
          </button>

          <button
            onClick={() =>
              setSelectedServeType("Jam")
            }
          >
            Jam
          </button>

          <button
            onClick={() =>
              setSelectedServeType("Drop")
            }
          >
            Drop
          </button>

          <button
            onClick={() =>
              setSelectedServeType("Tap-on")
            }
          >
            Tap-on
          </button>

          <p>
            Selected serve type: {selectedServeType}
          </p>
        </div>
      </div>

      {videoURL && (
        <div>
          <video
            ref={videoRef}
            src={videoURL}
            controls
            width="700"
          />

          <div>
            <h2>Serve Legality</h2>

            <button
              onClick={() =>
                setServeStatus("Legal")
              }
            >
              Legal
            </button>

            <button
              onClick={() =>
                setServeStatus("Fault")
              }
            >
              Fault
            </button>
          </div>

          {serveStatus === "Legal" && (
            <div>
              <h3>Serve Result</h3>

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
          )}

          {serveStatus === "Fault" && (
            <div>
              <h3>Fault Type</h3>

              <button
                onClick={() =>
                  setSelectedFaultType("Rim")
                }
              >
                Rim
              </button>

              <button
                onClick={() =>
                  setSelectedFaultType("High")
                }
              >
                High
              </button>

              <button
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
          )}

          {serveStatus === "Fault" &&
            selectedFaultType && (
              <div>
                <p>Played through?</p>

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
            )}

          <h2>Serves</h2>

          <ul>
            {serves.map((serve, index) => (
              <li key={serve.id}>
                <button
                  onClick={() =>
                    jumpToTimestamp(
                      serve.timestamp
                    )
                  }
                >
                  #{index + 1}
                  {" — "}
                  {serve.player}
                  {" — "}
                  Serve {serve.serveAttempt}
                  {" — "}
                  {serve.hand}
                  {" — "}
                  {serve.type}
                  {" — "}
                  {formatTime(serve.timestamp)}
                  {" — "}
                  {serve.legality}

                  {serve.faultType
                    ? ` (${serve.faultType})`
                    : ""}

                  {serve.playedThrough === true
                    ? " — Played Through"
                    : ""}

                  {serve.playedThrough === false
                    ? " — Not Played"
                    : ""}

                  {serve.result &&
                  serve.result !== "Fault"
                    ? ` — ${serve.result}`
                    : ""}
                </button>
              </li>
            ))}
          </ul>

          {rallyStarted &&
            !pendingWinningTeam && (
              <div>
                <h2>Who won the point?</h2>

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
            )}

          {pendingWinningTeam && (
            <div>
              <h2>How did the point end?</h2>

              <button
                onClick={() =>
                  finishPoint(
                    pendingWinningTeam,
                    "Kill"
                  )
                }
              >
                Kill
              </button>

              <button
                onClick={() =>
                  finishPoint(
                    pendingWinningTeam,
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
          )}

          <h2>Points</h2>

          <ul>
            {points.map((point, index) => (
              <li key={point.id}>
                Point {index + 1}
                {" — "}
                Server: {point.server}
                {" — "}
                Winner: {point.winningTeam}
                {" — "}
                Serves: {point.serves.length}
                {" — "}
                {point.outcome}
              </li>
            ))}
          </ul>

          <div>
            <h2>Match Statistics</h2>

            <p>
              Total Serves: {totalServes}
            </p>

            <p>
              Legal Serves:{" "}
              {percentage(
                legalServes,
                totalServes
              )}%
            </p>

            <p>
              Faults:{" "}
              {percentage(
                faultServes,
                totalServes
              )}%
            </p>

            <p>
              Aces: {aces}
            </p>

            <p>
              Double Faults: {doubleFaults}
            </p>

            <p>
              First Serve Legal:{" "}
              {percentage(
                firstServeLegal,
                firstServes.length
              )}%
            </p>

            <p>
              Second Serve Legal:{" "}
              {percentage(
                secondServeLegal,
                secondServes.length
              )}%
            </p>
          </div>

          <div>
            <h2>Player Statistics</h2>

            {playerStats.map((stats) => (
              <div key={stats.player}>
                <h3>{stats.player}</h3>

                <p>
                  Total Serves:{" "}
                  {stats.totalServes}
                </p>

                <p>
                  Legal Serves:{" "}
                  {percentage(
                    stats.legal,
                    stats.totalServes
                  )}%
                </p>

                <p>
                  Faults:{" "}
                  {percentage(
                    stats.faults,
                    stats.totalServes
                  )}%
                </p>

                <p>
                  Aces: {stats.aces}
                </p>

                <p>
                  Double Faults:{" "}
                  {stats.doubleFaults}
                </p>

                <p>
                  First Serve Legal:{" "}
                  {percentage(
                    stats.firstServeLegal,
                    stats.firstServes
                  )}%
                </p>

                <p>
                  Second Serve Legal:{" "}
                  {percentage(
                    stats.secondServeLegal,
                    stats.secondServes
                  )}%
                </p>

                <h4>Serve Breakdown</h4>

                {Object.entries(
                  stats.serveBreakdown
                ).map(
                  ([serveName, serveStats]) => (
                    <div key={serveName}>
                      <strong>
                        {serveName}
                      </strong>

                      <p>
                        Attempts:{" "}
                        {serveStats.attempts}
                      </p>

                      <p>
                        Legal:{" "}
                        {percentage(
                          serveStats.legal,
                          serveStats.attempts
                        )}%
                      </p>

                      <p>
                        Faults:{" "}
                        {percentage(
                          serveStats.faults,
                          serveStats.attempts
                        )}%
                      </p>

                      <p>
                        Aces:{" "}
                        {serveStats.aces}
                      </p>

                      <p>
                        Ace Rate:{" "}
                        {percentage(
                          serveStats.aces,
                          serveStats.attempts
                        )}%
                      </p>
                    </div>
                  )
                )}

                {stats.faults > 0 && (
                  <div>
                    <h4>Fault Breakdown</h4>

                    {Object.entries(
                      stats.faultBreakdown
                    )
                      .filter(
                        ([, count]) =>
                          count > 0
                      )
                      .map(
                        ([faultType, count]) => (
                          <div key={faultType}>
                            <strong>
                              {faultType}
                            </strong>

                            <p>
                              Count: {count}
                            </p>

                            <p>
                              Share of Faults:{" "}
                              {percentage(
                                count,
                                stats.faults
                              )}%
                            </p>
                          </div>
                        )
                      )}
                  </div>
                )}

                <h4>Point Statistics</h4>

                <p>
                  Points Served:{" "}
                  {stats.pointsServed}
                </p>

                <p>
                  Points Won While Serving:{" "}
                  {stats.servingWins}
                </p>

                <p>
                  Serving Point Win %:{" "}
                  {percentage(
                    stats.servingWins,
                    stats.pointsServed
                  )}%
                </p>

                <p>
                  First-Serve Point Win %:{" "}
                  {percentage(
                    stats.firstServePointWins,
                    stats.firstServePoints
                  )}%
                </p>

                <p>
                  Second-Serve Point Win %:{" "}
                  {percentage(
                    stats.secondServePointWins,
                    stats.secondServePoints
                  )}%
                </p>

                <p>
                  Points Won by Ace:{" "}
                  {stats.acePoints}
                </p>

                <p>
                  Points Lost by Double Fault:{" "}
                  {stats.doubleFaultPoints}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App