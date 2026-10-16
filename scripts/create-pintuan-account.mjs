import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PintuanStore } = require('../packages/server/dist/pintuan.store.js');
const [username, name, role] = process.argv.slice(2);
if (!username || !name || !['leader', 'buyer'].includes(role)) throw new Error('用法：node scripts/create-pintuan-account.mjs <账号> <名称> leader|buyer；密码通过 stdin 传入。');
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const store = new PintuanStore();
try { store.addAccount(username, name, password, role === 'leader'); console.log('账号已创建。'); }
finally { store.onModuleDestroy(); }
