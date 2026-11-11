import { describe, expect, it } from 'vitest';
import { chromeConfigError } from './publish-chrome.mjs';

describe('Chrome Web Store config', () => {
  it('names the values the publish step needs', () => {
    expect(chromeConfigError({})).toMatch(/CHROME_ACCESS_TOKEN/);
    expect(
      chromeConfigError({
        CHROME_ACCESS_TOKEN: 'token',
        CHROME_PUBLISHER_ID: 'publisher',
        CHROME_EXTENSION_ID: 'extension',
      }),
    ).toBe('');
  });
});
