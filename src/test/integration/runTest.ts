import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    // __dirname at runtime is dist/test/integration; project root is 3 levels up.
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index.js');
    // Fixtures live alongside source (non-TS files aren't copied to dist).
    const fixtureWorkspace = path.resolve(extensionDevelopmentPath, 'src/test/integration/fixtures/workspace');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [fixtureWorkspace, '--disable-extensions'],
    });
  } catch (err) {
    console.error('integration tests failed', err);
    process.exit(1);
  }
}

void main();
