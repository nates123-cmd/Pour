/**
 * Auth-only stand-in for src/lib/supabase.js, aliased in when VITE_HARNESS=1.
 * Reports a signed-in session so AuthGate falls straight through to the app.
 * Nothing here talks to the network, and it is never in a real build.
 */
const session = { user: { id: 'dev', email: 'nates123@gmail.com' } }

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
}
