import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { origin } from './book-collaboration/local.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const book = read('.book/project.json');
const config = read('deliveryguard.config.json');
const manifest = read('version-manifest.json');
const pkg = read('package.json');
const version = read(`.deliveryguard/versions/${manifest.currentVersion}.json`);
const registered = manifest.versions.find((entry) => entry.version === version.version);

assert.equal(book.role, 'learner');
assert.equal(config.project.id, book.repository.fullName.split('/').at(-1));
assert.equal(config.project.name, book.projectName);
assert.equal(manifest.project, book.projectId);
assert.equal(manifest.currentVersion, version.version);
assert.ok(pkg.scripts['guild:connect'].includes(`--project ${book.projectId}`));
assert.ok(pkg.scripts['guild:connect'].includes(`--site ${book.site}`));
assert.equal(origin(fileURLToPath(new URL('../', import.meta.url))).replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, ''), book.repository.fullName);
assert.equal(version.documents.filter((doc) => doc.primary).length, 1);
assert.deepEqual(registered.documents.map((doc) => [doc.url, doc.primary]), version.documents.map((doc) => [doc.ref, doc.primary]));
console.log('PASS: 本人项目、GitHub 仓库、版本与唯一主 PRD 登记一致');
