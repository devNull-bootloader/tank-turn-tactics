const { useSupabase } = require('./db_mode');

module.exports = useSupabase()
    ? require('./supabase_models').Types.ObjectId
    : require('mongoose').Types.ObjectId;
