# Privacy

Kana Helper reads Japanese text already visible on a page so it can draw kana and romaji above it.

That work happens in the browser. Page text, readings, and settings stay on the device. The extension has no account, no analytics, and no server. It does not upload page content.

Settings are stored with `chrome.storage.local`. The dictionary used to segment Japanese ships inside the extension package.

For per-site controls, Kana Helper reads the current website's hostname. Hostnames you disable are saved locally with your settings; the extension does not keep a log of visited pages. You can remove those choices by resetting the extension, and uninstalling the extension removes its locally stored settings.

Japanese page text is used only to generate annotations. A limited in-memory cache of readings can remain while the extension service worker is running; page text is not saved in persistent storage. The developer and third parties do not receive page text, hostnames, readings, or settings. Data is not sold, used for advertising, or used for credit or lending decisions. Kana Helper's use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

Questions: lakphy@outlook.com.
