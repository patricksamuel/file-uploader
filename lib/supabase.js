// lib/supabase.js
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY

if (!process.env.SUPABASE_URL || !supabaseKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(process.env.SUPABASE_URL, supabaseKey)
export const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads'
