const { createClient } = require('@supabase/supabase-js');

let client = null;

/**
 * Server-side Supabase client (anon or service role).
 * Returns null when env vars are not configured.
 */
function getSupabase() {
    if (client) {
        return client;
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
        return null;
    }

    client = createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    return client;
}

/**
 * Lightweight connectivity check against the hosted Postgres schema.
 */
async function pingSupabase() {
    const supabase = getSupabase();
    if (!supabase) {
        return { configured: false, ok: false, message: 'SUPABASE_URL / key not set' };
    }

    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) {
        return { configured: true, ok: false, message: error.message };
    }

    return { configured: true, ok: true, message: 'ok' };
}

module.exports = {
    getSupabase,
    pingSupabase
};
