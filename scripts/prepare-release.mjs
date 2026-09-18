import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const release = join(root, 'output', `release-${new Date().toISOString().replace(/[:.]/g, '-')}`);
for (const required of ['server/dist/index.js', 'web/dist/index.html']) if (!existsSync(join(root, required))) throw new Error(`先构建 ${required}`);
mkdirSync(release, { recursive: true });
for (const path of ['server/dist','server/package.json','server/pnpm-lock.yaml','server/.env.example','server/src/db/schema.sql','server/data/questions.json','web/dist']) {
  mkdirSync(join(release,path,'..'), {recursive:true});
  cpSync(join(root,path),join(release,path),{recursive:true});
}
function files(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]); }
const list=files(release);
if (list.some(p=>/\.db(?:-|$)|\/\.env$|\.test\.|node_modules|private-backups/.test(p))) throw new Error('发布包包含不应发布的数据');
const questions=JSON.parse(readFileSync(join(release,'server/data/questions.json'),'utf8'));
writeFileSync(join(release,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),questionCount:questions.length,basePath:'/pdl-tiku/',databaseIncluded:false,secretsIncluded:false,files:list.map(p=>({path:p.slice(release.length+1),sha256:createHash('sha256').update(readFileSync(p)).digest('hex')}))},null,2));
console.log(release);
