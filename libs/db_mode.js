/**
 * Prefer Supabase when explicitly enabled, or on Vercel without a Mongo DB_URI.
 */
function useSupabase() {
    if (process.env.USE_SUPABASE === 'true') return true;
    if (process.env.USE_SUPABASE === 'false') return false;
    return process.env.VERCEL === '1'
        && !!process.env.SUPABASE_URL
        && !process.env.DB_URI;
}

module.exports = { useSupabase };
