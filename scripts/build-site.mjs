// Assembles the deployable demo site in public/. Run after the package build.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const OUT = 'public';
const BUNDLE = 'cursorcrew.global.js';
const DEV_PATH = `../dist/${BUNDLE}`;

const html = readFileSync('demo/index.html', 'utf8');
if (!html.includes(DEV_PATH)) throw new Error(`demo/index.html no longer loads ${DEV_PATH}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
writeFileSync(`${OUT}/index.html`, html.replace(DEV_PATH, `./${BUNDLE}`));
for (const file of [BUNDLE, `${BUNDLE}.map`]) copyFileSync(`dist/${file}`, `${OUT}/${file}`);

console.log(`Site ready in ${OUT}/`);
