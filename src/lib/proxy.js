/**
 * Client for the suite's shared `claude` edge function.
 *
 * It is a multi-model relay, not a Claude-only one: it takes Anthropic-shaped
 * bodies and routes on the `model` string. Live model strings in use across the
 * suite are 'gemini-2.5-flash', 'claude-haiku-4-5' and 'claude-sonnet-4-6'.
 *
 * Deliberately NOT `supabase.functions.invoke`. That helper attaches an
 * `x-client-info` header, and the function's CORS policy allows only
 * `authorization, content-type, apikey`, so the browser preflight fails and the
 * request never leaves the device. supabase-js reports that as a bare "Failed to
 * send request to Edge Function", which reads like the function is down when
 * nothing was ever called. Same workaround as reading-app/src/lib/vision.js.
 */
import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export async function callModel(body) {
  const { data, error: sessionError } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (sessionError || !token) throw new Error('Signed out. Sign in and try again.')

  let res
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/claude`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the server. Check your connection.')
  }

  const payload = await res.json().catch(() => null)
  if (!res.ok || payload?.error) {
    throw new Error(payload?.error || `The server returned ${res.status}.`)
  }
  return textOf(payload)
}

function textOf(data) {
  if (typeof data === 'string') return data
  if (data?.text) return data.text
  if (Array.isArray(data?.content)) {
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
  return ''
}

/**
 * Tolerant JSON extraction.
 *
 * The proxy relays plain text, so there is no structured-output guarantee the
 * way there is when calling the API directly with a schema. A menu is also a
 * much bigger payload than the other suite calls, so a truncated response is a
 * real failure mode rather than a theoretical one. Report it as truncation
 * rather than as an unreadable photo, because the fix is different.
 */
export function extractJSON(raw) {
  if (!raw || typeof raw !== 'string') return null
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  try { return JSON.parse(s) } catch { /* fall through */ }
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export function looksTruncated(raw) {
  if (!raw) return false
  const s = raw.trim()
  return s.startsWith('{') && !s.endsWith('}') && !s.endsWith('```')
}

/** Downscale to 1568px long edge and re-encode JPEG. Same budget as vision.js. */
const MAX_EDGE = 1568
const JPEG_QUALITY = 0.8

export async function toImageBlock(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return {
    block: {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      },
    },
    dataUrl,
  }
}
