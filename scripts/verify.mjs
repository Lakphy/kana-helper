import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const fixtureRoot = join(root, 'test');
const chrome =
  process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const file = normalize(join(fixtureRoot, url.pathname === '/' ? 'fixture.html' : url.pathname));
  if (!file.startsWith(fixtureRoot)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    const type = extname(file) === '.html' ? 'text/html; charset=utf-8' : 'text/plain';
    response.writeHead(200, { 'content-type': type }).end(body);
  } catch {
    response.writeHead(404).end('missing');
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const pageUrl = `http://127.0.0.1:${port}/fixture.html`;

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--no-first-run', '--no-default-browser-check', '--window-size=1100,900'],
});

try {
  const client = await browser.target().createCDPSession();
  await client.send('Extensions.loadUnpacked', { path: dist });
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().includes('background.js'),
    { timeout: 15_000 },
  );
  const worker = await workerTarget.worker();
  worker?.on('console', (message) => console.log('SW', message.type(), message.text()));

  const page = await browser.newPage();
  page.on('console', (message) => console.log('PAGE', message.type(), message.text()));
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  const started = Date.now();
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#title .jkh-unit', { timeout: 20_000 });
  console.log('first ruby ms', Date.now() - started);
  await page.evaluate(() => document.querySelector('#shadow-host').scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => {
    const root = document.getElementById('shadow-host').shadowRoot;
    const text = [...root.querySelectorAll('.jkh-unit')]
      .map((unit) => unit.querySelector('.jkh-read')?.textContent ?? '')
      .join('');
    return /に|ni/.test(text);
  }, { timeout: 10_000 });

  const initial = await page.evaluate(() => {
    const read = (unit) => unit?.querySelector('.jkh-read')?.textContent ?? '';
    const baseText = (element) => {
      const clone = element.cloneNode(true);
      clone.querySelectorAll('.jkh-read').forEach((node) => node.remove());
      return (clone.textContent ?? '').replace(/\s+/g, '');
    };
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('main'));
    selection.removeAllRanges();
    selection.addRange(range);
    const shadow = document.getElementById('shadow-host').shadowRoot;
    return {
      titleText: baseText(document.getElementById('title')),
      titleReadings: [...document.querySelectorAll('#title .jkh-unit')].map(read),
      mainText: baseText(document.getElementById('main')),
      mainSelection: selection.toString().replace(/\s+/g, ''),
      linkReading: [...document.querySelectorAll('#link .jkh-unit')].map(read).join(''),
      englishRubies: document.querySelectorAll('#english .jkh-root').length,
      editorRubies: document.querySelectorAll('#editor .jkh-root').length,
      frozenRubies: document.querySelectorAll('#frozen .jkh-root').length,
      existingAnnotated: Boolean(document.querySelector('#existing .jkh-unit')),
      existingRt: document.querySelector('#existing rt')?.textContent ?? '',
      belowRubies: document.querySelectorAll('#below .jkh-root').length,
      shadowReadings: [...shadow.querySelectorAll('.jkh-unit')].map(read),
      rubyCount: document.querySelectorAll('.jkh-unit').length,
    };
  });
  console.log(JSON.stringify(initial, null, 2));

  check(initial.titleText === '私は学生です', `title text changed: ${initial.titleText}`);
  check(initial.titleReadings.some((item) => item.includes('wa') && item.includes('ta') && item.includes('shi')), `title missing aligned watashi: ${initial.titleReadings.join('|')}`);
  check(initial.titleReadings.some((item) => item.includes('ga') && item.includes('ku')), `kanji romaji is not aligned: ${initial.titleReadings.join('|')}`);
  check(initial.titleReadings.some((item) => item.replace(/\s/g, '') === 'wa'), `particle は should read wa: ${initial.titleReadings.join('|')}`);
  check(!initial.mainText.includes('toukyou') && !initial.mainText.includes('kyou'), 'romaji leaked into innerText');
  check(initial.mainText.includes('今日はいい天気なので、東京へ行って食べ物を食べます。'), 'main text missing');
  check(!/[a-z]{2,}/i.test(initial.mainSelection), `selection leaked readings: ${initial.mainSelection}`);
  check(
    initial.linkReading.includes('to') && initial.linkReading.includes('kyo'),
    `link reading: ${initial.linkReading}`,
  );
  check(initial.englishRubies === 0, 'english was annotated');
  check(initial.editorRubies === 0, 'contenteditable was annotated');
  check(initial.frozenRubies === 0, 'translate=no was annotated');
  check(!initial.existingAnnotated && initial.existingRt === 'かんじ', 'existing ruby was rewritten');
  check(initial.belowRubies === 0, 'offscreen paragraph was annotated immediately');
  check(/に|ni/.test(initial.shadowReadings.join('')), `shadow reading: ${initial.shadowReadings.join('|')}`);
  const initialSize = await page.evaluate(() => ({
    variable: getComputedStyle(document.documentElement).getPropertyValue('--jkh-size').trim(),
    pixels: parseFloat(getComputedStyle(document.querySelector('#title .jkh-read')).fontSize),
    rubies: document.querySelectorAll('.jkh-unit').length,
  }));
  check(initialSize.variable === '0.48em', `default size ${initialSize.variable}`);
  await worker.evaluate(() => chrome.storage.local.set({ fontSize: 72 }));
  await page.waitForFunction(
    (previous) => parseFloat(getComputedStyle(document.querySelector('#title .jkh-read')).fontSize) > previous + 2,
    {},
    initialSize.pixels,
  );
  const resized = await page.evaluate(() => ({
    variable: getComputedStyle(document.documentElement).getPropertyValue('--jkh-size').trim(),
    rubies: document.querySelectorAll('.jkh-unit').length,
  }));
  check(resized.variable === '0.72em', `resized variable ${resized.variable}`);
  check(resized.rubies === initialSize.rubies, 'changing size rebuilt the annotations');

  await page.evaluate(() => document.querySelector('#headline').scrollIntoView({ block: 'center' }));
  await page.waitForSelector('#headline .jkh-unit', { timeout: 10_000 });
  await page.screenshot({ path: '/tmp/jkh-headline.png' });
  await page.screenshot({ path: '/tmp/jkh-top.png' });
  await page.click('#link');
  check((await page.evaluate(() => location.hash)) === '#tokyo', 'link click did not navigate');

  await page.evaluate(() => document.querySelector('#frame').scrollIntoView({ block: 'center' }));
  const frame = page.frames().find((item) => item.url().includes('frame.html'));
  check(Boolean(frame), 'iframe missing');
  if (frame) {
    await frame.waitForSelector('.jkh-unit', { timeout: 10_000 });
    const frameReading = await frame.evaluate(() =>
      [...document.querySelectorAll('.jkh-unit')].map((unit) => unit.querySelector('.jkh-read')?.textContent ?? '').join(' '),
    );
    check(/fu|re|mu/.test(frameReading.replace(/\s/g, '')), `iframe reading: ${frameReading}`);
  }

  await page.evaluate(() => document.querySelector('#vert').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: '/tmp/jkh-vert.png' });
  await page.evaluate(() => document.querySelector('#frame').scrollIntoView({ block: 'center' }));

  await page.evaluate(() => document.querySelector('#below').scrollIntoView({ block: 'center' }));
  await page.waitForSelector('#below .jkh-unit', { timeout: 10_000 });

  await page.click('#swap');
  await page.waitForFunction(() => {
    const reading = [...document.querySelectorAll('#live .jkh-unit')]
      .map((unit) => unit.querySelector('.jkh-read')?.textContent ?? '')
      .join(' ');
    return reading.includes('ki') && reading.includes('う');
  }, { timeout: 10_000 });

  const before = await page.evaluate(() => document.querySelectorAll('.jkh-unit').length);
  await new Promise((resolveWait) => setTimeout(resolveWait, 600));
  const after = await page.evaluate(() => document.querySelectorAll('.jkh-unit').length);
  check(before === after, `ruby count grew ${before} -> ${after}`);

  await page.evaluate(() => document.querySelector('#title').scrollIntoView({ block: 'center' }));
  await worker.evaluate(() => chrome.storage.local.set({ kanaScript: 'katakana' }));
  await page.waitForFunction(() => {
    const reading = [...document.querySelectorAll('#title .jkh-unit')]
      .map((unit) => unit.querySelector('.jkh-read')?.textContent ?? '')
      .join(' ');
    return reading.includes('ワ') && reading.includes('タ') && reading.includes('シ');
  }, { timeout: 10_000 });

  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await page.waitForFunction(() => document.querySelectorAll('.jkh-unit').length === 0, { timeout: 10_000 });
  const disabledText = await page.evaluate(() => document.getElementById('title').innerText);
  check(disabledText === '私は学生です', `text lost when disabled: ${disabledText}`);

  await page.evaluate(() => document.querySelector('#title').scrollIntoView({ block: 'center' }));
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, kanaScript: 'hiragana' }));
  await page.waitForSelector('#title .jkh-unit', { timeout: 10_000 });

  await worker.evaluate(() => chrome.storage.local.set({ mode: 'kana' }));
  await page.waitForFunction(() => document.documentElement.dataset.jkhMode === 'kana');
  const romajiDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('#title .jkh-r')).display);
  check(romajiDisplay === 'none', `kana-only mode still shows romaji: ${romajiDisplay}`);
  await worker.evaluate(() => chrome.storage.local.set({ mode: 'both', scope: 'kanji' }));
  await page.waitForFunction(() => {
    if (document.documentElement.dataset.jkhScope !== 'kanji') return false;
    const bases = [...document.querySelectorAll('#title .jkh-unit')].map((unit) =>
      [...unit.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(''),
    );
    return bases.includes('私') && !bases.includes('は') && !bases.includes('で');
  }, { timeout: 10_000 });
  await worker.evaluate(() => chrome.storage.local.set({ scope: 'all' }));
  await page.waitForFunction(() => {
    if (document.documentElement.dataset.jkhScope !== 'all') return false;
    const bases = [...document.querySelectorAll('#title .jkh-unit')].map((unit) =>
      [...unit.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(''),
    );
    return bases.includes('は') && bases.includes('で');
  }, { timeout: 10_000 });

  const unitsBeforeFade = await page.evaluate(() => document.querySelectorAll('#title .jkh-unit').length);
  await page.evaluate(() => {
    document.querySelector('#title').style.color = '#9b1d3a';
  });
  await worker.evaluate(() => chrome.storage.local.set({ color: 'fade', opacity: 35 }));
  await page.waitForFunction(() => {
    const read = document.querySelector('#title .jkh-read');
    if (!read || document.documentElement.dataset.jkhColor !== 'fade') return false;
    const opacity = getComputedStyle(document.documentElement).getPropertyValue('--jkh-opacity').trim();
    const readStyle = getComputedStyle(read);
    const titleColor = getComputedStyle(document.querySelector('#title')).color;
    return opacity === '0.35' && Math.abs(parseFloat(readStyle.opacity) - 0.35) < 0.02 && readStyle.color === titleColor;
  }, { timeout: 10_000 });
  const unitsAfterFade = await page.evaluate(() => document.querySelectorAll('#title .jkh-unit').length);
  check(unitsBeforeFade === unitsAfterFade, `fade restyled by rescanning ${unitsBeforeFade} -> ${unitsAfterFade}`);
  const titleShot = await page.$('#title');
  if (titleShot) await titleShot.screenshot({ path: '/tmp/jkh-fade.png' });
  await worker.evaluate(() => chrome.storage.local.set({ color: 'auto', opacity: 50 }));
  await page.waitForFunction(() => document.documentElement.dataset.jkhColor === 'auto');

  const extensionId = new URL(workerTarget.url()).host;
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForSelector('#enabled');
  const popupState = await popup.evaluate(() => {
    const message = (key) => chrome.i18n.getMessage(key);
    return {
      enabled: document.querySelector('#enabled').checked,
      script: document.querySelector('input[name="kana"]:checked')?.value ?? '',
      name: document.querySelector('#app-name').textContent,
      hint: document.querySelector('.hint').textContent,
      hintExpected: message('hint'),
      fontSize: document.querySelector('#font-size').value,
      label: document.querySelector('#size-label').textContent,
      labelExpected: `${message('sizeHuge')} 72%`,
      tiny: message('sizeTiny'),
      mode: document.querySelector('input[name="mode"]:checked')?.value ?? '',
      scope: document.querySelector('input[name="scope"]:checked')?.value ?? '',
      color: document.querySelector('input[name="color"]:checked')?.value ?? '',
      skipCode: document.querySelector('#skip-code').checked,
      language: document.querySelector('#language').value,
      shortcut: document.querySelector('#shortcut').textContent,
      ui: chrome.i18n.getUILanguage(),
    };
  });
  check(popupState.name === 'Kana Helper', `app name ${popupState.name}`);
  check(popupState.enabled === true, 'popup toggle was off');
  check(popupState.script === 'hiragana', `popup script ${popupState.script}`);
  check(popupState.hint === popupState.hintExpected && popupState.hint.length > 0, `popup hint ${popupState.hint}`);
  check(popupState.mode === 'both', `popup mode ${popupState.mode}`);
  check(popupState.scope === 'all', `popup scope ${popupState.scope}`);
  check(popupState.color === 'auto', `popup color ${popupState.color}`);
  check(popupState.skipCode === false, 'skip code was on');
  check(popupState.language === 'auto', `popup language ${popupState.language}`);
  check(popupState.shortcut.length > 0, `shortcut ${popupState.shortcut}`);
  check(popupState.fontSize === '72', `popup size ${popupState.fontSize}`);
  check(popupState.label === popupState.labelExpected, `popup label ${popupState.label} ui ${popupState.ui}`);
  await popup.evaluate(() => {
    const input = document.querySelector('#font-size');
    input.value = '40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue('--jkh-size').trim() === '0.4em',
  );
  const afterSlider = await popup.evaluate(() => document.querySelector('#size-label').textContent);
  check(afterSlider === `${popupState.tiny} 40%`, `slider label ${afterSlider}`);
  await popup.evaluate(() => {
    const input = document.querySelector('input[name="color"][value="fade"]');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await popup.waitForFunction(() => document.querySelector('#opacity-row').hidden === false);
  await popup.evaluate(() => {
    const input = document.querySelector('#opacity');
    input.value = '40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue('--jkh-opacity').trim() === '0.4'
      && document.documentElement.dataset.jkhColor === 'fade',
  );
  const fadeLabel = await popup.evaluate(() => document.querySelector('#opacity-label').textContent);
  check(fadeLabel === '40%', `opacity label ${fadeLabel}`);
  const body = await popup.$('body');
  await body.screenshot({ path: '/tmp/jkh-popup.png' });
  console.log('popup', popupState, afterSlider, fadeLabel);

  async function chooseLanguage(code, enabledText, lang) {
    await popup.evaluate((value) => {
      const input = document.querySelector('#language');
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, code);
    await popup.waitForFunction(
      (expected, tag) =>
        document.querySelector('[data-i18n="enabledAll"]').textContent === expected &&
        document.documentElement.lang === tag &&
        document.querySelector('#app-name').textContent === 'Kana Helper',
      {},
      enabledText,
      lang,
    );
    const names = await popup.evaluate(() =>
      [...document.querySelectorAll('#language option')].map((option) => option.textContent),
    );
    check(
      ['English', '日本語', '简体中文', '繁體中文', '한국어'].every((name) => names.includes(name)),
      `${code} language names ${names.join('|')}`,
    );
    if (body) await body.screenshot({ path: `/tmp/jkh-popup-choice-${code}.png` });
  }
  await chooseLanguage('ja', 'すべてのサイトで表示', 'ja');
  await chooseLanguage('en', 'Show on all sites', 'en');
  const browserLocale = await popup.evaluate(() => {
    const ui = chrome.i18n.getUILanguage().toLowerCase();
    if (ui.startsWith('zh')) {
      return ui.includes('tw') || ui.includes('hk') || ui.includes('mo') || ui.includes('hant')
        ? ['zh-TW', null]
        : ['zh-CN', null];
    }
    if (ui.startsWith('ja')) return ['ja', null];
    if (ui.startsWith('ko')) return ['ko', null];
    return ['en', null];
  });
  const autoText = await popup.evaluate(() => chrome.i18n.getMessage('enabledAll'));
  await chooseLanguage('auto', autoText, browserLocale[0]);

  const localeSamples = [
    ['en', 'Show on all sites'],
    ['ja', 'すべてのサイトで表示'],
    ['zh_CN', '在所有网站显示'],
    ['zh_TW', '在所有網站顯示'],
    ['ko', '모든 사이트에 표시'],
  ];
  for (const [locale, enabledText] of localeSamples) {
    const painted = await popup.evaluate(async (code) => {
      const response = await fetch(chrome.runtime.getURL(`_locales/${code}/messages.json`));
      const messages = await response.json();
      const text = (key, substitution) => {
        let message = messages[key]?.message ?? '';
        const placeholders = messages[key]?.placeholders ?? {};
        for (const [name, placeholder] of Object.entries(placeholders)) {
          if (placeholder.content === '$1' && substitution) message = message.replaceAll(`$${name.toUpperCase()}$`, substitution);
        }
        return message;
      };
      document.querySelector('#app-name').textContent = 'Kana Helper';
      for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = text(node.dataset.i18n);
      document.querySelector('#site-row').hidden = false;
      document.querySelector('#site-label').textContent = text('siteHost', 'example.com');
      document.querySelector('#status').textContent = text('statusReady');
      document.querySelector('#shortcut').textContent = text('shortcut', 'Alt+Shift+J');
      const clipped = [...document.querySelectorAll('.segment label, .colors label, #status, #shortcut, .hint, #site-label, header strong')]
        .filter((el) => el.scrollWidth > el.clientWidth + 2)
        .map((el) => `${el.textContent} ${el.scrollWidth}>${el.clientWidth}`);
      return {
        enabled: document.querySelector('[data-i18n="enabledAll"]').textContent,
        name: document.querySelector('#app-name').textContent,
        clipped,
      };
    }, locale);
    check(painted.name === 'Kana Helper', `${locale} name ${painted.name}`);
    check(painted.enabled === enabledText, `${locale} catalog ${painted.enabled}`);
    check(painted.clipped.length === 0, `${locale} overflow ${painted.clipped.join(' | ')}`);
    if (body) await body.screenshot({ path: `/tmp/jkh-popup-${locale}.png` });
    console.log('locale', locale, painted.enabled, painted.clipped);
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log('verify ok');
