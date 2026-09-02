import { useEffect, useState } from 'react'
import { BottomNav } from './components/BottomNav'
import { signOut } from './auth/AuthGate'
import { supabase } from './lib/supabase'
import Wine from './pages/Wine'
import Cellar from './pages/Cellar'

// Wine is the default: it is the tab with an actual palate model behind it.
const START = 'wine'

export default function App() {
  const [tab, setTab] = useState(START)
  const [email, setEmail] = useState(null)

  /* Whose cellar this is. Worth stating, because the rows are per-user behind
   * RLS and an empty list on the wrong account looks identical to no data. */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null)
    })
  }, [])

  return (
    <>
      {tab === 'wine' ? <Wine /> : <Cellar key={tab} category={tab} />}
      <button className="signout" type="button" onClick={signOut}>
        {email ? `sign out — ${email}` : 'sign out'}
      </button>
      <BottomNav tab={tab} onChange={setTab} />
    </>
  )
}
