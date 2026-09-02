/**
 * Email one-time-code sign in, the suite's usual gate.
 *
 * Everything in sip_tastings is behind RLS on `auth.uid() = user_id`, so a
 * signed-out client does not get an error, it gets an empty list. That reads as
 * data loss rather than as a missing session, which is why the gate stands in
 * front of the app instead of the app handling a null session per screen.
 *
 * The screen is built out of the app's own devices -- the cover's circle
 * cluster, the masthead face, the tiny letterspaced caps label, the flat square
 * action block -- rather than a generic centred card. See DESIGN.md.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const STATES = { loading: 'loading', prompt: 'prompt', code: 'code', ready: 'ready' }

/* The palate scale doing duty as the wordmark. It is the app's one real motif
 * and the only thing on this screen that says which app you are signing in to
 * beyond the word itself. */
const SCALE = ['s1', 's2', 's3', 's4', 's5', 's6']

export function AuthGate({ children }) {
  const [state, setState] = useState(STATES.loading)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setState(data.session ? STATES.ready : STATES.prompt)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return
      setState(session ? STATES.ready : STATES.prompt)
    })
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [])

  const sendCode = async (e) => {
    e.preventDefault()
    if (!email || sending) return
    setSending(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    setSending(false)
    if (error) { setError(error.message); return }
    setCode(''); setState(STATES.code)
  }

  const verifyCode = async (e) => {
    e.preventDefault()
    if (code.length !== 8 || verifying) return
    setVerifying(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    setVerifying(false)
    if (error) { setError(error.message); return }
  }

  if (state === STATES.loading) return <div className="auth-shell" />
  if (state === STATES.ready) return children

  return (
    <div className="auth-shell">
      <div className="auth-col">
        <div className="scale auth-mark" aria-hidden="true">
          <div className="circles">
            {SCALE.map((s) => <span key={s} className={`dot ${s}`} />)}
          </div>
        </div>

        <h1>Sip</h1>
        <p className="sub">
          A drinks list, ranked against your own palate. Sign in to read your
          cellar and keep what you rate.
        </p>

        {state === STATES.prompt && (
          <form onSubmit={sendCode}>
            <label className="auth-label" htmlFor="auth-email">email</label>
            <div className="lookup">
              <input
                id="auth-email"
                type="email" autoComplete="email" autoFocus
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required
              />
            </div>
            <button className="shoot auth-go" type="submit" disabled={sending || !email}>
              {sending ? 'sending…' : 'email me a code'}
            </button>
            {error && <div className="err">{error}</div>}
            <div className="note">
              The code arrives from the suite, not from Sip. It can take a minute,
              and it expires.
            </div>
          </form>
        )}

        {state === STATES.code && (
          <form onSubmit={verifyCode}>
            <label className="auth-label" htmlFor="auth-code">8-digit code</label>
            <div className="lookup">
              <input
                id="auth-code"
                type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="12345678" maxLength={8} required
              />
            </div>
            <button className="shoot auth-go" type="submit" disabled={verifying || code.length !== 8}>
              {verifying ? 'verifying…' : 'sign in'}
            </button>
            {error && <div className="err">{error}</div>}
            <div className="note">Sent to {email}.</div>
            <button
              type="button" className="auth-alt"
              onClick={() => { setError(null); setCode(''); setState(STATES.prompt) }}
            >
              use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

/** Ends the session. Lives here because it is the other half of this gate. */
export async function signOut() {
  await supabase.auth.signOut()
}
