import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { origin } from './book-collaboration/local.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const config = read('deliveryguard.config.json');
const manifest = read('version-manifest.json');
const pkg = read('package.json');
const version = read(`.deliveryguard/versions/${manifest.currentVersion}.json`);
const registered = manifest.versions.find((entry) => entry.version === version.version);
const repository = origin(fileURLToPath(new URL('../', import.meta.url))).replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, '');

assert.equal(config.project.id, repository.split('/').at(-1));
assert.match(manifest.project, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
assert.equal(manifest.currentVersion, version.version);
assert.equal(pkg.scripts['guild:connect'].match(/--project (\S+)/)?.[1], manifest.project);
assert.equal(version.documents.filter((doc) => doc.primary).length, 1);
assert.deepEqual(registered.documents.map((doc) => [doc.url, doc.primary]), version.documents.map((doc) => [doc.ref, doc.primary]));

if (process.argv.includes('--local')) {
  const book = read('.book/project.json');
  assert.equal(book.role, 'learner');
  assert.equal(config.project.name, book.projectName);
  assert.equal(manifest.project, book.projectId);
  assert.equal(pkg.scripts['guild:connect'].match(/--site (\S+)/)?.[1], book.site);
  assert.equal(repository, book.repository.fullName);
  console.log('PASS: 本地 Book 身份与项目关联一致');
}
console.log('PASS: 工程配置、GitHub 仓库、版本与唯一主 PRD 登记一致');
