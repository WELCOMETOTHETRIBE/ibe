/**
 * Intent parser - loads and parses intent JSON files.
 * No validation is performed here - only parsing.
 */

import { readFileSync } from 'fs';
import { Intent } from './schema.js';

export function parseIntent(filePath: string): Intent {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(content);
  return parsed as Intent;
}

