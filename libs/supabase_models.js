const { getSupabase } = require('../config/supabase.js');
const { randomUUID } = require('crypto');

function db() {
    const client = getSupabase();
    if (!client) {
        throw new Error('Supabase is not configured');
    }
    return client;
}

function toId(value) {
    if (value == null) return null;
    if (typeof value === 'object' && value.id) return String(value.id);
    if (typeof value === 'object' && value._id) return String(value._id);
    return String(value);
}

function sameId(a, b) {
    return toId(a) != null && toId(a) === toId(b);
}

class Id {
    constructor(value = randomUUID()) {
        this.value = String(value);
    }
    toString() { return this.value; }
    toHexString() { return this.value; }
    equals(other) { return sameId(this.value, other); }
    toJSON() { return this.value; }
}

function asId(value) {
    if (value == null) return null;
    if (value instanceof Id) return value;
    return new Id(toId(value));
}

function mapRow(row) {
    if (!row) return null;
    const doc = { ...row, _id: asId(row.id) };
    if (row.user_id) doc.user_id = asId(row.user_id);
    if (row.game_id) doc.game_id = asId(row.game_id);
    if (row.creator_id) doc.creator_id = asId(row.creator_id);
    if (row.bounty_target) doc.bounty_target = asId(row.bounty_target);
    if (row.vote_jury) doc.vote_jury = asId(row.vote_jury);
    // camelCase aliases used by the Express app
    if (row.has_started != null) doc.hasStarted = row.has_started;
    if (row.started_at != null) doc.startedAt = row.started_at;
    if (row.turn_time != null) doc.turnTime = row.turn_time;
    if (row.turn_time_passed != null) doc.turnTimePassed = row.turn_time_passed;
    if (row.actions_per_interval != null) doc.actionsPerInterval = row.actions_per_interval;
    if (row.tie_count != null) doc.tieCount = row.tie_count;
    if (row.give_range_offset != null) doc.giveRangeOffset = row.give_range_offset;
    if (row.allow_always_join != null) doc.allowAlwaysJoin = row.allow_always_join;
    if (row.allow_vote_change != null) doc.allowVoteChange = row.allow_vote_change;
    if (row.do_action_queue != null) doc.doActionQueue = row.do_action_queue;
    if (row.do_broadcast_action != null) doc.doBroadcastAction = row.do_broadcast_action;
    if (row.do_fog_of_war != null) doc.doFogOfWar = row.do_fog_of_war;
    if (row.do_bounty != null) doc.doBounty = row.do_bounty;
    if (row.do_escort != null) doc.doEscort = row.do_escort;
    if (row.action_log != null) doc.actionLog = row.action_log;
    if (row.created_at != null) doc.createdAt = row.created_at;
    if (row.updated_at != null) doc.updatedAt = row.updated_at;
    return doc;
}

function gameToRow(data) {
    const row = {};
    const set = (snake, camel, fallback) => {
        if (data[camel] !== undefined) row[snake] = data[camel];
        else if (data[snake] !== undefined) row[snake] = data[snake];
        else if (fallback !== undefined) row[snake] = fallback;
    };

    if (data.name !== undefined) row.name = data.name;
    if (data.size !== undefined) row.size = data.size;
    if (data.password !== undefined) row.password = data.password;
    if (data.creator_id !== undefined) row.creator_id = toId(data.creator_id);

    set('has_started', 'hasStarted', false);
    set('started_at', 'startedAt', null);
    set('turn_time', 'turnTime', 24);
    set('turn_time_passed', 'turnTimePassed', 0);
    set('actions_per_interval', 'actionsPerInterval', 1);
    set('tie_count', 'tieCount', 2);
    set('give_range_offset', 'giveRangeOffset', -1);
    set('allow_always_join', 'allowAlwaysJoin', false);
    set('allow_vote_change', 'allowVoteChange', false);
    set('do_action_queue', 'doActionQueue', false);
    set('do_broadcast_action', 'doBroadcastAction', true);
    set('do_fog_of_war', 'doFogOfWar', false);
    set('do_bounty', 'doBounty', true);
    set('do_escort', 'doEscort', false);
    set('actions', 'actions', []);
    set('action_log', 'actionLog', []);
    row.updated_at = new Date().toISOString();
    return row;
}

function playerToRow(data) {
    const row = {};
    if (data.user_id !== undefined) row.user_id = toId(data.user_id);
    if (data.game_id !== undefined) row.game_id = toId(data.game_id);
    if (data.name !== undefined) row.name = data.name;
    if (data.position !== undefined) row.position = data.position;
    if (data.actions !== undefined) row.actions = data.actions;
    if (data.range !== undefined) row.range = data.range;
    if (data.sight !== undefined) row.sight = data.sight;
    if (data.health !== undefined) row.health = data.health;
    if (data.color !== undefined) row.color = data.color;
    if (data.bounty_target !== undefined) row.bounty_target = toId(data.bounty_target);
    if (data.vote_jury !== undefined) row.vote_jury = toId(data.vote_jury);
    row.updated_at = new Date().toISOString();
    return row;
}

function wrap(doc, table, toRow) {
    if (!doc) return null;
    const proxy = {
        ...doc,
        async save() {
            const payload = toRow(this);
            const { data, error } = await db()
                .from(table)
                .update(payload)
                .eq('id', toId(this._id))
                .select('*')
                .single();
            if (error) throw error;
            Object.assign(this, mapRow(data));
            return this;
        },
        toObject() {
            return { ...this };
        }
    };
    // Keep ObjectId-like equality helpers on nested ids
    return proxy;
}

function leanList(rows) {
    return (rows || []).map(mapRow);
}

const User = {
    async findOne(query = {}) {
        let q = db().from('users').select('*');
        if (query.email) q = q.eq('email', query.email);
        if (query._id || query.id) q = q.eq('id', toId(query._id || query.id));
        const { data, error } = await q.maybeSingle();
        if (error) throw error;
        return wrap(mapRow(data), 'users', (d) => ({
            email: d.email,
            hash: d.hash,
            salt: d.salt,
            admin: !!d.admin,
            updated_at: new Date().toISOString()
        }));
    },
    async findById(id) {
        return this.findOne({ id });
    },
    create(data) {
        const doc = {
            _id: asId(data._id || randomUUID()),
            email: data.email,
            hash: data.hash,
            salt: data.salt,
            admin: !!data.admin
        };
        return {
            ...doc,
            async save() {
                const { data: row, error } = await db().from('users').insert({
                    id: toId(this._id),
                    email: this.email,
                    hash: this.hash,
                    salt: this.salt,
                    admin: !!this.admin
                }).select('*').single();
                if (error) throw error;
                Object.assign(this, mapRow(row));
                return this;
            }
        };
    }
};

const Game = {
    async find(query = {}) {
        let q = db().from('games').select('*');
        if (query.hasStarted != null || query.has_started != null) {
            q = q.eq('has_started', query.hasStarted ?? query.has_started);
        }
        if (query._id || query.id) q = q.eq('id', toId(query._id || query.id));
        const { data, error } = await q;
        if (error) throw error;
        return leanList(data).map(row => wrap(row, 'games', gameToRow));
    },
    async findOne(query = {}) {
        const rows = await this.find(query);
        return rows[0] || null;
    },
    async findById(id) {
        const { data, error } = await db().from('games').select('*').eq('id', toId(id)).maybeSingle();
        if (error) throw error;
        return wrap(mapRow(data), 'games', gameToRow);
    },
    async findByIdAndUpdate(id, update) {
        const row = gameToRow(update);
        const { data, error } = await db().from('games').update(row).eq('id', toId(id)).select('*').single();
        if (error) throw error;
        return wrap(mapRow(data), 'games', gameToRow);
    },
    async findByIdAndDelete(id) {
        const { error } = await db().from('games').delete().eq('id', toId(id));
        if (error) throw error;
    },
    async deleteOne(query) {
        if (query._id || query.id) {
            await this.findByIdAndDelete(query._id || query.id);
        }
    },
    create(data) {
        const id = asId(data._id || randomUUID());
        const doc = mapRow({
            id: toId(id),
            ...gameToRow({
                actions: [],
                actionLog: [],
                hasStarted: false,
                turnTime: 24,
                turnTimePassed: 0,
                actionsPerInterval: 1,
                ...data
            }),
            name: data.name,
            size: data.size,
            creator_id: toId(data.creator_id)
        });
        return {
            ...doc,
            _id: id,
            async save() {
                const payload = {
                    id: toId(this._id),
                    ...gameToRow(this),
                    name: this.name,
                    size: this.size,
                    creator_id: toId(this.creator_id)
                };
                const { data: row, error } = await db().from('games').upsert(payload).select('*').single();
                if (error) throw error;
                Object.assign(this, mapRow(row));
                return this;
            }
        };
    }
};

// Support `new Game(data)` style used throughout controllers
function GameConstructor(data = {}) {
    return Game.create(data);
}
Object.assign(GameConstructor, Game);

const Player = {
    async find(query = {}) {
        let q = db().from('players').select('*');
        if (query.game_id) q = q.eq('game_id', toId(query.game_id));
        if (query.user_id) q = q.eq('user_id', toId(query.user_id));
        if (query._id || query.id) q = q.eq('id', toId(query._id || query.id));
        if (query.position) {
            // JSON contains match for exact position object
            q = q.contains('position', query.position);
        }
        const { data, error } = await q;
        if (error) throw error;
        return leanList(data).map(row => wrap(row, 'players', playerToRow));
    },
    async findOne(query = {}) {
        const rows = await this.find(query);
        return rows[0] || null;
    },
    async findById(id) {
        const { data, error } = await db().from('players').select('*').eq('id', toId(id)).maybeSingle();
        if (error) throw error;
        return wrap(mapRow(data), 'players', playerToRow);
    },
    async deleteMany(query = {}) {
        let q = db().from('players').delete();
        if (query.game_id) {
            if (query.game_id.$in) {
                q = q.in('game_id', query.game_id.$in.map(toId));
            } else {
                q = q.eq('game_id', toId(query.game_id));
            }
        }
        const { error } = await q;
        if (error) throw error;
    },
    create(data) {
        const id = asId(data._id || randomUUID());
        const doc = {
            _id: id,
            user_id: asId(data.user_id),
            game_id: asId(data.game_id),
            name: data.name,
            position: data.position,
            actions: data.actions ?? 1,
            range: data.range ?? 1,
            sight: data.sight ?? 1,
            health: data.health ?? 3,
            color: data.color ?? '#00ffc3',
            bounty_target: data.bounty_target ? asId(data.bounty_target) : null,
            vote_jury: data.vote_jury ? asId(data.vote_jury) : null
        };
        return {
            ...doc,
            async save() {
                const payload = {
                    id: toId(this._id),
                    ...playerToRow(this)
                };
                const { data: row, error } = await db().from('players').upsert(payload).select('*').single();
                if (error) throw error;
                Object.assign(this, mapRow(row));
                return this;
            }
        };
    }
};

function PlayerConstructor(data = {}) {
    return Player.create(data);
}
Object.assign(PlayerConstructor, Player);

// Query helpers used by controllers: Model.find(...).lean()
function attachLean(model) {
    const originalFind = model.find.bind(model);
    model.find = async function (...args) {
        const rows = await originalFind(...args);
        rows.lean = async () => rows.map(r => ({ ...r }));
        return rows;
    };
    const originalFindById = model.findById.bind(model);
    model.findById = async function (...args) {
        const row = await originalFindById(...args);
        if (row) {
            row.lean = async () => ({ ...row });
        }
        return row;
    };
}

attachLean(GameConstructor);
attachLean(PlayerConstructor);

module.exports = {
    User,
    Game: GameConstructor,
    Player: PlayerConstructor,
    Types: { ObjectId: Id },
    sameId,
    toId,
    asId
};
