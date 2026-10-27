const { createSupportStore } = require('../support-db');
const { loadLocalEnv } = require('../server');

async function main() {
  loadLocalEnv();
  const store = createSupportStore();
  await store.ready;
  const faqs = await store.getFaqs();
  console.log(`Support database ready with ${faqs.length} FAQ records.`);
}

main().catch(error => {
  console.error(`Support database initialization failed: ${error.message}`);
  process.exitCode = 1;
});
