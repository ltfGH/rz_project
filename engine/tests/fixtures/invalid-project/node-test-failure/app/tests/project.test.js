const test = require('node:test');
test('fixture fails', () => { throw new Error('expected failure'); });
