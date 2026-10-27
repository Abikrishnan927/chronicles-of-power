const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

test('static deployment config resolves assets beneath the GitHub Pages project path and disables APIs', () => {
  const source = fs.readFileSync(require.resolve('../deployment-config.js'), 'utf8');
  const context = {
    window: {},
    location: { href: 'https://abikrishnan927.github.io/chronicles-of-power/', origin: 'https://abikrishnan927.github.io' },
    document: { currentScript: { src: 'https://abikrishnan927.github.io/chronicles-of-power/deployment-config.js' } },
    URL
  };
  vm.runInNewContext(source, context);

  const deployment = context.window.COPDeployment;
  assert.equal(deployment.basePath, '/chronicles-of-power/');
  assert.equal(deployment.backendConfigured, false);
  assert.equal(deployment.accountApiConfigured, false);
  assert.equal(deployment.asset('data/history-events.json'), 'https://abikrishnan927.github.io/chronicles-of-power/data/history-events.json');
  assert.throws(() => deployment.api('api/history/events'), error => error.code === 'BACKEND_NOT_CONFIGURED');
});

test('static deployment can be configured for a separately hosted Django account API', () => {
  const context = {
    window: { COP_ACCOUNT_API_BASE_URL: 'https://accounts.example.test' },
    location: { href: 'https://example.test/chronicles-of-power/', origin: 'https://example.test' },
    document: { currentScript: { src: 'https://example.test/chronicles-of-power/deployment-config.js' } },
    URL
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../deployment-config.js'), 'utf8'), context);
  assert.equal(context.window.COPDeployment.accountApiConfigured, true);
  assert.equal(context.window.COPDeployment.accountApiBaseUrl, 'https://accounts.example.test');
});

test('static catalogue loader reads the bundled records and preserves 1,000-record page slices', async () => {
  const origin = 'https://abikrishnan927.github.io';
  const window = {};
  const controls = new Map();
  const createElement = () => {
    const element = {
      classList: { add(value) { this[value] = true; }, toggle() {} },
      append() {},
      addEventListener() {},
      remove() {}
    };
    Object.defineProperty(element, 'src', {
      set(value) { this.resolvedSrc = new URL(value, `${origin}/chronicles-of-power/`).href; },
      get() { return this.resolvedSrc; }
    });
    return element;
  };
  const loader = createElement();
  const retry = createElement();
  const scripts = [];
  const document = {
    currentScript: { src: `${origin}/chronicles-of-power/deployment-config.js` },
    querySelector(selector) {
      if (!controls.has(selector)) controls.set(selector, selector === '#catalog-loader' ? loader : selector === '#catalog-retry' ? retry : createElement());
      return controls.get(selector);
    },
    createElement,
    body: {
      append(script) {
        scripts.push(script.src);
        queueMicrotask(() => script.onload());
      }
    }
  };
  const context = {
    window,
    document,
    location: { href: `${origin}/chronicles-of-power/`, origin, pathname: '/chronicles-of-power/' },
    URL,
    fetch: async url => {
      assert.equal(url, `${origin}/chronicles-of-power/data/history-events.json`);
      const events = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/history-events.json'), 'utf8'));
      return { ok: true, json: async () => events };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../deployment-config.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../catalog-loader.js'), 'utf8'), context, { timeout: 5000 });
  for (let attempt = 0; attempt < 100 && !loader.classList.hidden; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(window.COPCatalogStatus.imported, 10000);
  assert.equal(window.COPCatalogStatus.pages, 10);
  assert.equal(window.COPImportedEvents.length, 10000);
  assert.equal(scripts.length, 7);
  assert.ok(scripts.every(url => url.startsWith(`${origin}/chronicles-of-power/`)));
});

test('static files and the existing catalogue are served under the GitHub Pages project subpath without an API', async t => {
  const app = express();
  app.use('/chronicles-of-power', express.static(path.resolve(__dirname, '..')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/chronicles-of-power`;

  for (const asset of [
    '/', '/deployment-config.js', '/styles.css', '/catalog-loader.js', '/support-error.js',
    '/catalog-index.js', '/campaign-data.js', '/engine.js', '/universal-scenarios.js',
    '/app.js', '/ai-ui.js', '/account-ui.js', '/support/support.css', '/support/support.js',
    '/support-catalog.js', '/data/history-events.json'
  ]) {
    const response = await fetch(`${base}${asset}`);
    assert.equal(response.status, 200, `${asset} should resolve below the project path`);
  }
  const missingApi = await fetch(`${base}/api/history/events`);
  assert.equal(missingApi.status, 404);
  const records = await (await fetch(`${base}/data/history-events.json`)).json();
  assert.equal(records.length, 10000);
  assert.equal(records.slice(0, 1000).length, 1000);
  assert.equal(records.slice(9000, 10000).length, 1000);
});
