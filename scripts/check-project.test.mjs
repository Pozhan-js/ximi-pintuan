import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('CI 与本地 Book 校验分离，登记错误仍失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'pintuan-project-check-'));
  const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const write = (path, data) => writeFileSync(join(root, path), JSON.stringify(data));
  const run = (...args) => spawnSync(process.execPath, ['scripts/check-project.mjs', ...args], { cwd: root, encoding: 'utf8' });
  const expectStatus = (status, ...args) => {
    const result = run(...args);
    assert.equal(result.status, status, result.stderr || result.stdout);
  };
  try {
    for (const path of ['scripts/check-project.mjs', 'scripts/book-collaboration', 'package.json', 'deliveryguard.config.json', 'version-manifest.json', '.deliveryguard/versions']) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      cpSync(new URL(`../${path}`, import.meta.url), join(root, path), { recursive: true });
    }
    const manifest = read('version-manifest.json');
    const config = read('deliveryguard.config.json');
    const site = read('package.json').scripts['guild:connect'].match(/--site (\S+)/)[1];
    const repository = `learner/${config.project.id}`;
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync('git', ['remote', 'add', 'origin', `https://github.com/${repository}.git`], { cwd: root });

    // CI 必须能在没有 .book 的 clone 中运行，本地模式则要求关联文件。
    expectStatus(0);
    expectStatus(1, '--local');
    mkdirSync(join(root, '.book'));
    const book = { site, projectId: manifest.project, projectName: config.project.name, role: 'learner', repository: { fullName: repository } };
    write('.book/project.json', book);
    expectStatus(0, '--local');
    write('.book/project.json', { ...book, role: 'teaching-template' });
    expectStatus(0);
    expectStatus(1, '--local');
    write('.book/project.json', { ...book, projectId: 'wrong-project' });
    expectStatus(0);
    expectStatus(1, '--local');

    writeFileSync(join(root, '.book/project.json'), 'invalid JSON');
    expectStatus(0);
    expectStatus(1, '--local');

    write('version-manifest.json', { ...manifest, project: 'wrong-project' });
    expectStatus(1);
    write('version-manifest.json', manifest);
    manifest.versions.find((version) => version.version === manifest.currentVersion).documents[0].primary = false;
    write('version-manifest.json', manifest);
    expectStatus(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
