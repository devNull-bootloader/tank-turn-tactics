/**
 *
 * @param {number} count
 * @param {Object} size
 * @param {number} size.width
 * @param {number} size.height
 * @param {{x: number, y: number}[]} takenLocations
 * @return {{x: number, y: number}[]}
 */
module.exports.assignLocation = function (count, size, takenLocations=[]) {
    const takenLocationStrings = takenLocations.map(p => JSON.stringify(p))
    let coords = new Set(takenLocationStrings);

    while (coords.size < count + takenLocationStrings.length) {
        const width = Math.floor(Math.random() * size.width);
        const height = Math.floor(Math.random() * size.height);
        coords.add(JSON.stringify({x: width, y: height})) // Stringify to bypass object shallow equality
    }

    let coordsArray = Array.from(coords)
    coordsArray = coordsArray.slice(takenLocationStrings.length, coords.size)

    // Reconvert set to array and parse json
    return coordsArray.map(strObjects => JSON.parse(strObjects));
}

/**
 * Must match the function in public/js/game-engine/Game.js
 * @param position
 * @param target
 * @param range
 * @return {boolean}
 */
module.exports.checkRange = function (position, target, range) {
    return Math.sqrt(Math.pow(target.x - position.x, 2) + Math.pow(target.y - position.y, 2)) <= range;
}

module.exports.checkGrid = function (position, game) {
    return position.x >= 0 && position.y >= 0 && position.x < game.size.width && position.y < game.size.height
}

const UPGRADE_COST = {
    health: 2,
    range: 1,
    sight: 1
};

module.exports.UPGRADE_COST = UPGRADE_COST;

/**
 * Action-point cost for a queued/immediate action payload.
 * @param {string} action
 * @param {Object} data
 * @return {number}
 */
module.exports.actionPointCost = function (action, data) {
    switch (action) {
        case 'move':
            return Array.isArray(data.positions) ? data.positions.length : 0;
        case 'attack':
        case 'give':
            return parseInt(data.count, 10) || 0;
        case 'upgrade':
            return (UPGRADE_COST[data.upgrade] || 0) * (parseInt(data.count, 10) || 0);
        default:
            return 0;
    }
}

/**
 * Assign each alive player a random other alive player as their bounty target.
 * @param {import('mongoose').Document[]} players
 * @return {Promise<void>}
 */
module.exports.assignBounties = async function (players) {
    const alive = players.filter(p => p.health > 0);

    for (const player of alive) {
        const others = alive.filter(o => !o._id.equals(player._id));
        player.bounty_target = others.length
            ? others[Math.floor(Math.random() * others.length)]._id
            : null;
        await player.save();
    }

    for (const player of players.filter(p => p.health <= 0)) {
        if (player.bounty_target) {
            player.bounty_target = null;
            await player.save();
        }
    }
}

/**
 * Coerce HTML form boolean values ("true"/"false", checkbox presence).
 * @param {*} value
 * @param {boolean} defaultValue
 * @return {boolean}
 */
module.exports.coerceBoolean = function (value, defaultValue = false) {
    if (Array.isArray(value)) {
        // HTML hidden+checkbox pairs often submit as [falseValue, trueValue]
        value = value[value.length - 1];
    }
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    return String(value).toLowerCase() === 'true' || String(value) === 'on' || String(value) === '1';
}