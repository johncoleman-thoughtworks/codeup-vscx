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
