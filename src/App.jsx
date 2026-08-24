import { useRef, useState } from "react"

function App() {
  const videoRef = useRef(null)

  const [videoURL, setVideoURL] = useState(null)
  const [serves, setServes] = useState([])
  const [selectedPlayer, setSelectedPlayer] = useState("Player 1")
  const [players, setPlayers] = useState([
    "Player 1",
    "Player 2",
    "Player 3",
    "Player 4"
  ])

  function handleVideoUpload(event) {
    const file = event.target.files[0]

    if (file) {
      const url = URL.createObjectURL(file)
      setVideoURL(url)
      setServes([])
    }
  }

  function markServe(result) {
    const currentTime = videoRef.current.currentTime

    const newServe = {
      timestamp: currentTime,
      player: selectedPlayer,
      result: result
    }

    setServes([...serves, newServe])
  }

  function jumpToTimestamp(time) {
    videoRef.current.currentTime = time
    videoRef.current.play()
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)

    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
  }

  function updatePlayerName(index, newName) {
    const updatedPlayers = [...players]
    updatedPlayers[index] = newName
    setPlayers(updatedPlayers)

    if (selectedPlayer === players[index]) {
      setSelectedPlayer(newName)
    }
  }

  return (
    <div>
      <h1>Roundnet Analyzer</h1>
      <p>Upload a match to begin analyzing your game.</p>

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
                updatePlayerName(index, event.target.value)
              }
            />
          </div>
        ))}

        <h2>Select Server</h2>

        {players.map((player, index) => (
          <button
            key={index}
            onClick={() => setSelectedPlayer(player)}
          >
            {player}
          </button>
        ))}

        <p>Selected: {selectedPlayer}</p>
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
            <button onClick={() => markServe("Ace")}>
              Ace
            </button>

            <button onClick={() => markServe("Returned")}>
              Returned
            </button>

            <button onClick={() => markServe("Fault")}>
              Fault
            </button>
          </div>

          <h2>Serves</h2>

          <ul>
            {serves.map((serve, index) => (
              <li key={index}>
                <button onClick={() => jumpToTimestamp(serve.timestamp)}>
                  {serve.player} — Serve {index + 1} — {formatTime(serve.timestamp)} — {serve.result}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default App