const {test} = require('node:test');
const assert = require('node:assert/strict');
const {sameStartTime} = require('../scripts/local-postgres');

test('local cluster identity accepts only its exact or next-second startup timestamp', () => {
    assert.equal(sameStartTime(1700000000, '1700000000'), true);
    assert.equal(sameStartTime(1700000000, '1700000001'), true);
    for (const observed of ['1699999999', '1700000002', '1700000900', '', null, undefined, NaN, Infinity, '1700000000.5']) {
        assert.equal(sameStartTime(1700000000, observed), false);
    }
    for (const stored of [0, -1, NaN, 1700000000.5]) assert.equal(sameStartTime(stored, 1700000000), false);
});
