import React, { useEffect, useState } from 'react'

function App(): React.JSX.Element {
  const [bridgeStatus, setBridgeStatus] = useState<string>('checking…')

  useEffect(() => {
    window.api
      .ping()
      .then(() => {
        setBridgeStatus('IPC bridge: ok')
      })
      .catch(() => {
        setBridgeStatus('IPC bridge: error')
      })
  }, [])

  return (
    <div>
      <h1>LiveTranscriber</h1>
      <p>{bridgeStatus}</p>
    </div>
  )
}

export default App
