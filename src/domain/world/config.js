import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const worldConfigPath = path.resolve(moduleDirectory, '../../../data/world_zones.json');

export const WORLD_CONFIG = JSON.parse(fs.readFileSync(worldConfigPath, 'utf8'));
