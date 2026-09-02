import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Fail the build when the Supabase env is missing, instead of shipping a
 * hollow bundle.
 *
 * src/lib/supabase.js throws at module scope if the env is absent. During a
 * production build rollup treats that as an unconditional throw and
 * dead-code-eliminates everything imported after it -- so the build still
 * reports "63 modules transformed / built in 271ms" and exits 0, but the
 * output is vendor code plus a throw, and the deployed page is blank white.
 *
 * This has bitten this suite more than once, and it is invisible in CI logs.
 * The only tell is the bundle SIZE, which nobody checks. So check the env
 * here, before any of that can happen.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k])

  if (missing.length && mode === 'production') {
    throw new Error(
      `Missing ${missing.join(', ')}.\n` +
        'Refusing to build: without these the app code is dead-code-eliminated, ' +
        'so the build "succeeds" while producing a blank page.\n' +
        'Locally: cp .env.example .env and fill it in.\n' +
        'In CI: check the repo secrets exist AND that the run started after they were set.',
    )
  }

  /* Everything in Sip is behind an email one-time code, so the saved lists
   * cannot be looked at in development without a code from a live inbox. With
   * VITE_HARNESS=1 the auth client and the tastings store are swapped for
   * in-memory fakes (harness/) so the screens can actually be rendered and
   * judged. Dev only, and refused outright in a production build so it can
   * never be the reason a real deploy ships fake data. */
  const harness = process.env.VITE_HARNESS === '1'
  if (harness && mode === 'production') {
    throw new Error('VITE_HARNESS=1 in a production build. The harness serves fake data.')
  }

  const at = (p) => fileURLToPath(new URL(p, import.meta.url))
  const swap = {
    [at('./src/lib/supabase.js')]: at('./harness/supabase.js'),
    [at('./src/lib/tastings.js')]: at('./harness/tastings.js'),
  }

  /* resolve.alias matches the IMPORT SPECIFIER, and these modules are imported
   * as './supabase' from lib and '../lib/supabase' from pages, so no single
   * alias key catches them all. Resolve first, then swap on the resolved path. */
  const harnessPlugin = {
    name: 'sip-harness',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const found = await this.resolve(source, importer, { ...options, skipSelf: true })
      return found ? swap[found.id.split('?')[0]] || null : null
    },
  }

  return {
    plugins: harness ? [harnessPlugin, react()] : [react()],
    base: process.env.BASE_URL || '/',
  }
})
