import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IntentConfig, layerForFile } from '../../intent/layers';

const intent: IntentConfig = {
  layers: [
    { layer: 'domain', match: 'src/main/java/com/x/domain/', cannotDependOn: ['infrastructure', 'web'] },
    { layer: 'application', match: 'src/main/java/com/x/application/', cannotDependOn: ['web'] },
    { layer: 'web', match: 'src/main/java/com/x/web/', cannotDependOn: [] },
    { layer: 'infrastructure', match: 'src/main/java/com/x/infrastructure/', cannotDependOn: [] },
    // Broader prefix; longest-prefix wins
    { layer: 'everything', match: 'src/main/java/com/x/', cannotDependOn: [] },
  ],
};

test('layerForFile returns the most specific (longest-prefix) match', () => {
  assert.equal(layerForFile('src/main/java/com/x/domain/Order.java', intent), 'domain');
  assert.equal(layerForFile('src/main/java/com/x/web/Controller.java', intent), 'web');
  assert.equal(layerForFile('src/main/java/com/x/other/Thing.java', intent), 'everything');
});

test('layerForFile returns undefined for files outside any prefix', () => {
  assert.equal(layerForFile('src/test/X.java', intent), undefined);
});

test('layerForFile: glob pattern matches across monorepo packages', () => {
  const monorepo: IntentConfig = {
    layers: [
      { layer: 'domain', match: 'packages/*/src/**/domain/**', cannotDependOn: ['infrastructure', 'web'] },
      { layer: 'web', match: 'packages/*/src/**/web/**', cannotDependOn: [] },
      { layer: 'infrastructure', match: 'packages/*/src/**/infrastructure/**', cannotDependOn: [] },
    ],
  };
  assert.equal(layerForFile('packages/api/src/main/java/domain/Order.java', monorepo), 'domain');
  assert.equal(layerForFile('packages/worker/src/main/kotlin/web/Handler.kt', monorepo), 'web');
  assert.equal(layerForFile('packages/api/src/main/java/infrastructure/Db.java', monorepo), 'infrastructure');
  assert.equal(layerForFile('packages/api/README.md', monorepo), undefined);
});

test('layerForFile: literal file globs work', () => {
  const cfg: IntentConfig = {
    layers: [
      { layer: 'config', match: '**/*.config.ts', cannotDependOn: [] },
    ],
  };
  assert.equal(layerForFile('src/app/foo.config.ts', cfg), 'config');
  assert.equal(layerForFile('src/app/foo.ts', cfg), undefined);
});

test('layerForFile: backward-compat — trailing-slash prefix still works', () => {
  const cfg: IntentConfig = {
    layers: [
      { layer: 'domain', match: 'src/domain/', cannotDependOn: [] },
    ],
  };
  assert.equal(layerForFile('src/domain/Order.java', cfg), 'domain');
  assert.equal(layerForFile('src/domain/nested/Deep.java', cfg), 'domain');
  assert.equal(layerForFile('src/web/Other.java', cfg), undefined);
});
