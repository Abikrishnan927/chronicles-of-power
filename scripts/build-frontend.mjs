import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const staticFiles = [
  'index.html', 'styles.css', 'catalog-loader.js', 'catalog-index.js', 'campaign-data.js',
  'engine.js', 'universal-scenarios.js', 'app.js', 'ai-ui.js', 'account-ui.js',
  'deployment-config.js', 'support-error.js', 'support-catalog.js'
];
const backendUrl = process.env.PUBLIC_API_BASE_URL || '';
const accountUrl = process.env.ACCOUNT_API_BASE_URL || '';
for (const value of [backendUrl, accountUrl]) {
  if (value && (!/^https:\/\//i.test(value) || /localhost|127\.0\.0\.1/i.test(value))) {
    throw new Error('Frontend API URLs must use the deployed HTTPS host; localhost is not allowed in a production build.');
  }
}
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of staticFiles) fs.copyFileSync(path.join(root, file), path.join(output, file));
for (const directory of ['assets', 'data', 'support']) {
  fs.cpSync(path.join(root, directory), path.join(output, directory), { recursive: true });
}
const renderStaticErrorPage = (file, code, title, message) => {
  const template = fs.readFileSync(path.join(root, 'support', file), 'utf8')
    .replace('href="support.css"', 'href="support/support.css"')
    .replace('src="../deployment-config.js"', 'src="deployment-config.js"')
    .replace('src="../support-catalog.js"', 'src="support-catalog.js"')
    .replace('src="support.js"', 'src="support/support.js"')
    .replaceAll('{{ERROR_CODE}}', code)
    .replaceAll('{{ERROR_TITLE}}', title)
    .replaceAll('{{ERROR_HEADING}}', title)
    .replaceAll('{{ERROR_MESSAGE}}', message)
    .replaceAll('{{ERROR_CAUSE}}', 'The requested page or service could not be completed.')
    .replaceAll('{{ERROR_GUIDANCE}}', 'Check the address, then retry or ask the support assistant.')
    .replaceAll('{{ERROR_GUIDANCE_LIST}}', '<li>Check the address and retry.</li><li>Ask the support assistant if you still need help.</li>')
    .replaceAll('{{REQUEST_ID}}', 'Available in the service response when provided.')
    .replaceAll('{{RETRY_BUTTON}}', code === '500' ? '<button class="primary-button" id="retry-page" type="button">Try again</button>' : '');
  fs.writeFileSync(path.join(output, code === '404' ? '404.html' : '500.html'), template, 'utf8');
};
renderStaticErrorPage('404.html', '404', 'Page Not Found', 'The page you requested could not be found.');
renderStaticErrorPage('500.html', '500', 'Internal Server Error', 'The service could not complete this request.');
const encoded = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(path.join(output, 'deployment-config.js'),
  `window.COP_BACKEND_API_BASE_URL=${encoded(backendUrl)};window.COP_ACCOUNT_API_BASE_URL=${encoded(accountUrl)};\n` +
  fs.readFileSync(path.join(root, 'deployment-config.js'), 'utf8'), 'utf8');
console.log(`Static frontend built in dist/ (backend ${backendUrl ? 'configured' : 'not configured'}).`);
