import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  compareSemver,
  dueForCheck,
  isAllowedVsixUrl,
  isNewer,
  parseRelease,
} from '../../util/updateCheckPure';

test('isAllowedVsixUrl accepts GitHub release asset hosts', () => {
  assert.equal(isAllowedVsixUrl('https://github.com/org/repo/releases/download/v1/foo.vsix'), true);
  assert.equal(isAllowedVsixUrl('https://objects.githubusercontent.com/release-assets/x.vsix'), true);
  assert.equal(isAllowedVsixUrl('https://release-assets.githubusercontent.com/x.vsix'), true);
});

test('isAllowedVsixUrl rejects non-allowlisted origins', () => {
  assert.equal(isAllowedVsixUrl('https://evil.example/x.vsix'), false);
  assert.equal(isAllowedVsixUrl('https://github.com.evil.example/x.vsix'), false);
  assert.equal(isAllowedVsixUrl('http://github.com/x.vsix'), false);
  assert.equal(isAllowedVsixUrl('file:///tmp/x.vsix'), false);
  assert.equal(isAllowedVsixUrl('not a url'), false);
});

test('compareSemver: basic ordering', () => {
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.0.0', '1.0.1'), -1);
  assert.equal(compareSemver('1.0.1', '1.0.0'), 1);
  assert.equal(compareSemver('1.10.0', '1.2.0'), 1);
  assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
});

test('compareSemver: tolerates v prefix on either side', () => {
  assert.equal(compareSemver('v1.2.0', '1.2.0'), 0);
  assert.equal(compareSemver('1.2.0', 'v1.2.0'), 0);
  assert.equal(compareSemver('v1.2.1', 'v1.2.0'), 1);
});

test('compareSemver: prerelease tags are ignored', () => {
  assert.equal(compareSemver('1.0.0-beta.1', '1.0.0'), 0);
  assert.equal(compareSemver('1.0.0', '1.0.0-rc.1'), 0);
});

test('compareSemver: malformed input does not throw', () => {
  // Invalid components default to 0; result is well-defined even if junk
  assert.equal(typeof compareSemver('nonsense', '1.0.0'), 'number');
  assert.equal(typeof compareSemver('', '0.0.0'), 'number');
});

test('isNewer: thin wrapper', () => {
  assert.equal(isNewer('1.2.0', '1.1.0'), true);
  assert.equal(isNewer('1.1.0', '1.2.0'), false);
  assert.equal(isNewer('1.1.0', '1.1.0'), false);
  assert.equal(isNewer('v1.2.0', '1.1.0'), true);
});

test('dueForCheck: undefined last-check means due', () => {
  assert.equal(dueForCheck(undefined, 86_400_000, Date.now()), true);
});

test('dueForCheck: zero last-check means due', () => {
  assert.equal(dueForCheck(0, 86_400_000, Date.now()), true);
});

test('dueForCheck: recently-checked means not due', () => {
  const now = 1_000_000_000;
  assert.equal(dueForCheck(now - 60_000, 86_400_000, now), false);
});

test('dueForCheck: at exactly the interval boundary, due', () => {
  const now = 1_000_000_000;
  assert.equal(dueForCheck(now - 86_400_000, 86_400_000, now), true);
});

test('dueForCheck: well past interval, due', () => {
  const now = 1_000_000_000;
  assert.equal(dueForCheck(now - 1_000_000_000, 86_400_000, now), true);
});

test('parseRelease: extracts tag + url + vsix asset', () => {
  const raw = {
    tag_name: 'v1.2.0',
    html_url: 'https://github.com/x/y/releases/tag/v1.2.0',
    assets: [
      { name: 'codeup-1.2.0.vsix', browser_download_url: 'https://example.com/codeup-1.2.0.vsix' },
      { name: 'source.zip', browser_download_url: 'https://example.com/source.zip' },
    ],
  };
  const parsed = parseRelease(raw);
  assert.ok(parsed);
  assert.equal(parsed?.tag, 'v1.2.0');
  assert.equal(parsed?.vsixUrl, 'https://example.com/codeup-1.2.0.vsix');
  assert.equal(parsed?.prerelease, false);
});

test('parseRelease: returns undefined for malformed input', () => {
  assert.equal(parseRelease(null), undefined);
  assert.equal(parseRelease({}), undefined);
  assert.equal(parseRelease({ tag_name: 'v1.0.0' }), undefined);
  assert.equal(parseRelease('not an object'), undefined);
});

test('parseRelease: no vsix asset is still a valid release', () => {
  const raw = {
    tag_name: 'v0.1.0',
    html_url: 'https://example.com',
    assets: [{ name: 'source.zip', browser_download_url: 'https://example.com/s.zip' }],
  };
  const parsed = parseRelease(raw);
  assert.ok(parsed);
  assert.equal(parsed?.vsixUrl, undefined);
});

test('parseRelease: prerelease flag preserved', () => {
  const parsed = parseRelease({
    tag_name: 'v1.2.0-rc.1',
    html_url: 'https://example.com',
    prerelease: true,
  });
  assert.equal(parsed?.prerelease, true);
});
