import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { testEnvironment, bomFixturePath } from '../config/environment.mjs';

test('environment selection rejects typos and preserves the default QA fixture', () => {
    assert.equal(testEnvironment({}), null);
    assert.equal(bomFixturePath({}), '../data/bom.json');
    assert.equal(bomFixturePath({ TEST_ENV: 'qa' }), '../data/bom.json');
    assert.equal(bomFixturePath({ TEST_ENV: 'prod' }), '../data/prod/bom.json');
    assert.throws(() => testEnvironment({ TEST_ENV: 'production' }), /TEST_ENV/);
});

test('both BOM fixtures use the current workflow combo and retain their own item data', () => {
    for (const TEST_ENV of ['qa', 'prod']) {
        const fixture = JSON.parse(readFileSync(`k6/flows/${bomFixturePath({ TEST_ENV })}`, 'utf8'));
        const ctx = vm.createContext({ open: () => JSON.stringify(fixture) });
        const source = readFileSync('k6/flows/bom.js', 'utf8')
            .replace(/^import [^\n]+\n/gm, '')
            .replace('open(import.meta.resolve(bomFixturePath(__ENV)))', 'open()')
            .replace(/^export /gm, '');
        vm.runInContext(source, ctx);
        const payload = JSON.parse(JSON.stringify(ctx.buildBomPayload('new-combo')));
        assert.deepEqual(payload.bomEntries, fixture.bomEntries);
        assert.ok(payload.fabricEntries.every(entry => entry.comboId === 'new-combo' && !entry.id));
        assert.ok(payload.fabricEntries.every(entry => entry.compositions.every(value => !value.id)));
        assert.ok(fixture.fabricEntries.every(entry => entry.comboId !== 'new-combo'));
    }
});
