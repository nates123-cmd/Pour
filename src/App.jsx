import { useState } from 'react'
import { BottomNav } from './components/BottomNav'
import Wine from './pages/Wine'
import Cellar from './pages/Cellar'

// Wine is the default: it is the tab with an actual palate model behind it.
const START = 'wine'

export default function App() {
  const [tab, setTab] = useState(START)
  return (
    <>
      {tab === 'wine' ? <Wine /> : <Cellar key={tab} category={tab} />}
      <BottomNav tab={tab} onChange={setTab} />
    </>
  )
}
