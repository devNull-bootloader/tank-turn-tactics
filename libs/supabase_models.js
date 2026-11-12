const { getSupabase } = require('../config/supabase.js');
const { randomUUID } = require('crypto');

function db() {
    const client = getSupabase();
    if (!client) throw new Error('Supabase is not configured');
    return client;
}

function toId(value) {
    if (value == null) return null;
    if (typeof value === 'object' && value.value) return String(value.value);
    if (typeof value === 'object' && value.id) return String(value.id);
    if (typeof value === 'object' && value._id) return toId(value._id);
    return String(value);
}

function sameId(a, b) {
    return toId(a) != null && toId(a) === toId(b);
}

function Id(value = randomUUID()) {
    if (!(this instanceof Id)) {
        return new Id(value);
    }
    this.value = String(value == null ? randomUUID() : value);
}
Id.prototype.toString = function toString() { return this.value; };
Id.prototype.valueOf = function valueOf() { return this.value; };
Id.prototype.toHexString = function toHexString() { return this.value; };
Id.prototype.equals = function equals(other) { return sameId(this.value, other); };
Id.prototype.toJSON = function toJSON() { return this.value; };

function asId(value) {
    if (value == null) return null;
    if (value instanceof Id) return value;
    return new Id(toId(value));
}

function mapRow(row) {
    if (!row) return null;
    const doc = { ...row };
    doc._id = asId(row.id);
    doc.id = toId(row.id);
    if (row.user_id != null) doc.user_id = asId(row.user_id);
    if (row.game_id != null) doc.game_id = asId(row.game_id);
    if (row.creator_id != null) doc.creator_id = asId(row.creator_id);
    if (row.bounty_target != null) doc.bounty_target = asId(row.bounty_target);
    else doc.bounty_target = null;
    if (row.vote_jury != null) doc.vote_jury = asId(row.vote_jury);
    else doc.vote_jury = null;

    doc.hasStarted = row.has_started;
    doc.startedAt = row.started_at;
    doc.turnTime = row.turn_time;
    doc.turnTimePassed = row.turn_time_passed;
    doc.actionsPerInterval = row.actions_per_interval;
    doc.tieCount = row.tie_count;
    doc.giveRangeOffset = row.give_range_offset;
    doc.allowAlwaysJoin = row.allow_always_join;
    doc.allowVoteChange = row.allow_vote_change;
    doc.doActionQueue = row.do_action_queue;
    doc.doBroadcastAction = row.do_broadcast_action;
    doc.doFogOfWar = row.do_fog_of_war;
    doc.doBounty = row.do_bounty;
    doc.doEscort = row.do_escort;
    doc.vsBots = row.vs_bots;
    doc.quickMatch = row.quick_match;
    doc.isTutorial = row.is_tutorial;
    doc.isBot = row.is_bot;
    doc.actionLog = row.action_log || [];
    doc.actions = row.actions || [];
    doc.createdAt = row.created_at;
    doc.updatedAt = row.updated_at;
    return doc;
}

function gameToRow(data) {
    const row = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) row.name = data.name;
    if (data.size !== undefined) row.size = data.size;
    if (data.password !== undefined) row.password = data.password;
    if (data.creator_id !== undefined) row.creator_id = toId(data.creator_id);
    if (data.hasStarted !== undefined || data.has_started !== undefined) {
        row.has_started = data.hasStarted ?? data.has_started;
    }
    if (data.startedAt !== undefined || data.started_at !== undefined) {
        row.started_at = data.startedAt ?? data.started_at;
    }
    if (data.turnTime !== undefined || data.turn_time !== undefined) {
        row.turn_time = data.turnTime ?? data.turn_time;
    }
    if (data.turnTimePassed !== undefined || data.turn_time_passed !== undefined) {
        row.turn_time_passed = data.turnTimePassed ?? data.turn_time_passed;
    }
    if (data.actionsPerInterval !== undefined || data.actions_per_interval !== undefined) {
        row.actions_per_interval = data.actionsPerInterval ?? data.actions_per_interval;
    }
    if (data.doActionQueue !== undefined || data.do_action_queue !== undefined) {
        row.do_action_queue = data.doActionQueue ?? data.do_action_queue;
    }
    if (data.doBroadcastAction !== undefined || data.do_broadcast_action !== undefined) {
        row.do_broadcast_action = data.doBroadcastAction ?? data.do_broadcast_action;
    }
    if (data.doFogOfWar !== undefined || data.do_fog_of_war !== undefined) {
        row.do_fog_of_war = data.doFogOfWar ?? data.do_fog_of_war;
    }
    if (data.doBounty !== undefined || data.do_bounty !== undefined) {
        row.do_bounty = data.doBounty ?? data.do_bounty;
    }
    if (data.allowAlwaysJoin !== undefined || data.allow_always_join !== undefined) {
        row.allow_always_join = data.allowAlwaysJoin ?? data.allow_always_join;
    }
    if (data.vsBots !== undefined || data.vs_bots !== undefined) {
        row.vs_bots = data.vsBots ?? data.vs_bots;
    }
    if (data.quickMatch !== undefined || data.quick_match !== undefined) {
        row.quick_match = data.quickMatch ?? data.quick_match;
    }
    if (data.isTutorial !== undefined || data.is_tutorial !== undefined) {
        row.is_tutorial = data.isTutorial ?? data.is_tutorial;
    }
    if (data.actions !== undefined) row.actions = data.actions;
    if (data.actionLog !== undefined || data.action_log !== undefined) {
        row.action_log = data.actionLog ?? data.action_log;
    }
    return row;
}

function playerToRow(data) {
    const row = { updated_at: new Date().toISOString() };
    if (data.user_id !== undefined) row.user_id = toId(data.user_id);
    if (data.game_id !== undefined) row.game_id = toId(data.game_id);
    if (data.name !== undefined) row.name = data.name;
    if (data.position !== undefined) row.position = data.position;
    if (data.actions !== undefined) row.actions = data.actions;
    if (data.range !== undefined) row.range = data.range;
    if (data.sight !== undefined) row.sight = data.sight;
    if (data.health !== undefined) row.health = data.health;
    if (data.color !== undefined) row.color = data.color;
    if (data.isBot !== undefined || data.is_bot !== undefined) {
        row.is_bot = data.isBot ?? data.is_bot;
    }
    if (data.bounty_target !== undefined) row.bounty_target = toId(data.bounty_target);
    if (data.vote_jury !== undefined) row.vote_jury = toId(data.vote_jury);
    return row;
}

function attachSave(doc, table, toRow) {
    if (!doc) return null;
    doc.save = async function save() {
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
    };
    doc.toObject = function toObject() { return { ...this }; };
    doc.updateOne = async function updateOne() { return this.save(); };
    return doc;
}

function thenable(executor) {
    let lean = false;
    const api = {
        lean() {
            lean = true;
            return api;
        },
        exec() {
            return executor(lean);
        },
        then(onFulfilled, onRejected) {
            return executor(lean).then(onFulfilled, onRejected);
        },
        catch(onRejected) {
            return executor(lean).catch(onRejected);
        }
    };
    return api;
}

function mapUserRow(row) {
    const doc = mapRow(row);
    if (!doc) return null;
    doc.username = row.username || (row.email ? String(row.email).split('@')[0] : null);
    doc.guest = !!row.guest;
    doc.debug = !!row.debug;
    doc.bot = !!row.bot;
    doc.admin = !!row.admin;
    doc.email = row.email || null;
    // passport / templates expect .id
    doc.id = toId(doc._id);
    return doc;
}

const User = function User(data = {}) {
    if (!(this instanceof User)) return new User(data);
    const id = asId(data._id || data.id || randomUUID());
    Object.assign(this, {
        _id: id,
        id: toId(id),
        username: data.username,
        email: data.email || null,
        hash: data.hash,
        salt: data.salt,
        guest: !!data.guest,
        debug: !!data.debug,
        bot: !!data.bot,
        admin: !!data.admin
    });
    this.save = async () => {
        const { data: row, error } = await db().from('users').upsert({
            id: toId(this._id),
            username: this.username,
            email: this.email,
            hash: this.hash,
            salt: this.salt,
            guest: !!this.guest,
            debug: !!this.debug,
            bot: !!this.bot,
            admin: !!this.admin,
            updated_at: new Date().toISOString()
        }).select('*').single();
        if (error) throw error;
        Object.assign(this, mapUserRow(row));
        return this;
    };
};

User.findOne = function findOne(query = {}, callback) {
    const result = thenable(async () => {
        let q = db().from('users').select('*');
        if (query.username) q = q.eq('username', query.username);
        if (query.email) q = q.eq('email', query.email);
        if (query._id || query.id) q = q.eq('id', toId(query._id || query.id));
        const { data, error } = await q.maybeSingle();
        if (error) throw error;
        return attachSave(mapUserRow(data), 'users', (d) => ({
            username: d.username,
            email: d.email,
            hash: d.hash,
            salt: d.salt,
            guest: !!d.guest,
            debug: !!d.debug,
            bot: !!d.bot,
            admin: !!d.admin,
            updated_at: new Date().toISOString()
        }));
    });

    if (typeof callback === 'function') {
        result.then(doc => callback(null, doc)).catch(err => callback(err));
        return;
    }
    return result;
};

User.findById = function findById(id, callback) {
    return User.findOne({ id }, callback);
};

const Game = function Game(data = {}) {
    if (!(this instanceof Game)) return new Game(data);
    const id = asId(data._id || data.id || randomUUID());
    Object.assign(this, {
        _id: id,
        name: data.name,
        size: data.size,
        creator_id: asId(data.creator_id),
        hasStarted: data.hasStarted ?? false,
        startedAt: data.startedAt,
        turnTime: data.turnTime ?? 24,
        turnTimePassed: data.turnTimePassed ?? 0,
        actionsPerInterval: data.actionsPerInterval ?? 1,
        allowAlwaysJoin: data.allowAlwaysJoin ?? false,
        doActionQueue: data.doActionQueue ?? false,
        doBroadcastAction: data.doBroadcastAction ?? true,
        doFogOfWar: data.doFogOfWar ?? false,
        doBounty: data.doBounty ?? true,
        vsBots: data.vsBots ?? false,
        quickMatch: data.quickMatch ?? false,
        isTutorial: data.isTutorial ?? false,
        actions: data.actions ?? [],
        actionLog: data.actionLog ?? []
    });
    this.save = async () => {
        const payload = {
            id: toId(this._id),
            name: this.name,
            size: this.size,
            creator_id: toId(this.creator_id),
            ...gameToRow(this)
        };
        const { data: row, error } = await db().from('games').upsert(payload).select('*').single();
        if (error) throw error;
        Object.assign(this, mapRow(row));
        return this;
    };
};

Game.find = function find(query = {}) {
    return thenable(async (lean) => {
        let q = db().from('games').select('*');
        if (query.hasStarted != null) q = q.eq('has_started', query.hasStarted);
        if (query._id || query.id) q = q.eq('id', toId(query._id || query.id));
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data || []).map(mapRow);
        if (lean) return rows;
        return rows.map(r => attachSave(r, 'games', gameToRow));
    });
};

Game.findOne = function findOne(query = {}) {
    return thenable(async (lean) => {
        const rows = await Game.find(query);
        const row = (await rows)[0] || null;
        // rows may already be resolved via thenable confusion — handle both
        return row;
    });
};

// Fix findOne properly
Game.findOne = function findOne(query = {}) {
    return thenable(async (lean) => {
        let q = db().from('games').select('*');
        if (query.hasStarted != null) q = q.eq('has_started', query.hasStarted);
        if (query._id || query.id) q = q.eq('id', toId(query._id || query.id));
        const { data, error } = await q.limit(1).maybeSingle();
        if (error) throw error;
        const row = mapRow(data);
        return lean ? row : attachSave(row, 'games', gameToRow);
    });
};

Game.findById = function findById(id) {
    return thenable(async (lean) => {
        const { data, error } = await db().from('games').select('*').eq('id', toId(id)).maybeSingle();
        if (error) throw error;
        const row = mapRow(data);
        return lean ? row : attachSave(row, 'games', gameToRow);
    });
};

Game.findByIdAndUpdate = async function findByIdAndUpdate(id, update) {
    const { data, error } = await db().from('games').update(gameToRow(update)).eq('id', toId(id)).select('*').single();
    if (error) throw error;
    return attachSave(mapRow(data), 'games', gameToRow);
};

Game.findByIdAndDelete = async function findByIdAndDelete(id) {
    const { error } = await db().from('games').delete().eq('id', toId(id));
    if (error) throw error;
};

Game.deleteOne = async function deleteOne(query) {
    if (query && (query._id || query.id)) {
        await Game.findByIdAndDelete(query._id || query.id);
    }
};

const Player = function Player(data = {}) {
    if (!(this instanceof Player)) return new Player(data);
    const id = asId(data._id || data.id || randomUUID());
    Object.assign(this, {
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
        isBot: data.isBot ?? false,
        bounty_target: data.bounty_target ? asId(data.bounty_target) : null,
        vote_jury: data.vote_jury ? asId(data.vote_jury) : null
    });
    this.save = async () => {
        const payload = {
            id: toId(this._id),
            ...playerToRow(this)
        };
        const { data: row, error } = await db().from('players').upsert(payload).select('*').single();
        if (error) throw error;
        Object.assign(this, mapRow(row));
        return this;
    };
};

Player.find = function find(query = {}) {
    return thenable(async (lean) => {
        let q = db().from('players').select('*');
        if (query.game_id) q = q.eq('game_id', toId(query.game_id));
        if (query.user_id) q = q.eq('user_id', toId(query.user_id));
        if (query._id || query.id) q = q.eq('id', toId(query._id || query.id));
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data || []).map(mapRow);
        return lean ? rows : rows.map(r => attachSave(r, 'players', playerToRow));
    });
};

Player.findOne = function findOne(query = {}) {
    return thenable(async (lean) => {
        const rows = await Player.find(query).lean();
        const row = rows[0] || null;
        return lean ? row : attachSave(row, 'players', playerToRow);
    });
};

Player.findById = function findById(id) {
    return thenable(async (lean) => {
        const { data, error } = await db().from('players').select('*').eq('id', toId(id)).maybeSingle();
        if (error) throw error;
        const row = mapRow(data);
        return lean ? row : attachSave(row, 'players', playerToRow);
    });
};

Player.deleteMany = async function deleteMany(query = {}) {
    let q = db().from('players').delete();
    if (query.game_id) {
        if (query.game_id.$in) q = q.in('game_id', query.game_id.$in.map(toId));
        else q = q.eq('game_id', toId(query.game_id));
    }
    const { error } = await q;
    if (error) throw error;
};

module.exports = {
    User,
    Game,
    Player,
    Types: { ObjectId: Id },
    sameId,
    toId,
    asId
};
