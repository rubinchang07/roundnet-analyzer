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
  const [teams, setTeams] = useState([
    [0, 1],
    [2, 3]
  ])
  const team1 = teams[0].map((index) => players[index])
  const team2 = teams[1].map((index) => players[index])
  const [selectedServeType, setSelectedServeType] = useState("None")
  const [serveStatus, setServeStatus] = useState(null)
  const [selectedFaultType, setSelectedFaultType] = useState(null)

  const [points, setPoints] = useState([])
  const [currentPointServes, setCurrentPointServes] = useState([])
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
    }
  }

  function markServe(result, faultType = null, playedThrough = null) {
    const currentTime = videoRef.current.currentTime

    const newServe = {
      timestamp: currentTime,
      player: selectedPlayer,
      type: selectedServeType,
      legality: serveStatus,
      faultType,
      playedThrough,
      result
    }

    setServes([...serves, newServe])
    setCurrentPointServes([...currentPointServes, newServe])

    setServeStatus(null)
    setSelectedFaultType(null)
  }

  function finishPoint(winningTeam) {
    if (currentPointServes.length === 0) {
      return
    }

    const newPoint = {
      server: currentPointServes[0].player,
      serves: currentPointServes,
      winningTeam: winningTeam
    }

    setPoints([...points, newPoint])
    setCurrentPointServes([])
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

  // Get the most recently recorded serve in the current point
  const latestServe =
    currentPointServes[currentPointServes.length - 1]

  // A rally exists if the most recent serve was legal
  // or if a fault was played through
  const rallyStarted =
    latestServe &&
    (
      latestServe.legality === "Legal" ||
      latestServe.playedThrough === true
    )

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
            onClick={() => setSelectedPlayer(player)}
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
              <li key={index}>
                <button
                  onClick={() =>
                    jumpToTimestamp(
                      serve.timestamp
                    )
                  }
                >
                  #{index + 1} — {serve.player} —{" "}
                  {serve.type} —{" "}
                  {formatTime(serve.timestamp)} —{" "}
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

          {rallyStarted && (
            <div>
              <h2>Who won the point?</h2>

              <button onClick={() => finishPoint("Team 1")}>
                {team1.join(" / ")}
              </button>

              <button onClick={() => finishPoint("Team 2")}>
                {team2.join(" / ")}
              </button>
            </div>
          )}

          <h2>Points</h2>

          <ul>
            {points.map((point, index) => (
              <li key={index}>
                Point {index + 1} — Server: {point.server} — Winner: {point.winningTeam} — Serves: {point.serves.length}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default App