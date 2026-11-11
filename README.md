# Kana Helper

在网页上的日文上方标注假名和罗马字。注音在本机完成，页面文字不会上传。

Show kana and romaji above Japanese text. Readings are created on the device.

界面语言：跟随浏览器，或在弹出菜单里选择 English、日本語、简体中文、繁體中文、한국어。

## Load unpacked

```sh
npm ci
npm test
npm run build
```

Open `chrome://extensions`, turn on Developer mode, and load the `dist` folder.

## Release

Pushing `main` runs three workflows, in order:

1. **CI** — typecheck, test, and build.
2. **Release** — when CI passes and `manifest.json` `version` has no `v` tag yet, package `dist` and publish a GitHub Release.
3. **Publish** — upload that zip to the Chrome Web Store, and register the tag with the [FOSS Extensions Store](https://foss-extensions.store) (the open Chromium extension store). The store builds the tag from this public repository.

Bump `version` in `manifest.json` before the push that should ship. A push that does not change the version still runs CI and does not open a second release.

The Chrome Web Store API cannot create the first listing. Download `kana-helper-vX.Y.Z.zip` from the GitHub Release, upload it once in the [developer dashboard](https://chrome.google.com/webstore/devconsole), and fill in the listing and privacy tabs. Privacy text: [PRIVACY.md](PRIVACY.md). Later versions are uploaded by the Publish workflow.

### Repository secrets

Chrome Web Store, service account (preferred):

- `CWS_SERVICE_ACCOUNT_JSON`
- `CHROME_PUBLISHER_ID`
- `CHROME_EXTENSION_ID`

Or OAuth instead of the service account JSON:

- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`
- `CHROME_PUBLISHER_ID`
- `CHROME_EXTENSION_ID`

Enable the Chrome Web Store API, then follow [service accounts](https://developer.chrome.com/docs/webstore/service-accounts) or [the OAuth setup](https://developer.chrome.com/docs/webstore/using-api).

FOSS Extensions Store, only until the registry pull request is merged:

- `CODEBERG_TOKEN` — a Codeberg token that can open a pull request. After `extensions/kana-helper.yaml` is on the registry, new `v*` tags are built without this token.

Re-run **Publish** from the Actions tab after the secrets exist. Publishing the same version again is rejected by the Chrome Web Store, so use a new manifest version for the next upload.
