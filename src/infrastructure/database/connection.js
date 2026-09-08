import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '../../..');

// DATA_DIR override lets a host mount a persistent volume (e.g. Render disk at /var/data)
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(repositoryRoot, 'data');

export const DB_PATH = path.join(DATA_DIR, 'paradise.db');

export function createLocalDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  return new DatabaseSync(DB_PATH);
}
