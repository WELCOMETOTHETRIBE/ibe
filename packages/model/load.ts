/**
 * Loading and validating system models from JSON/YAML with untrusted-input
 * defenses, then wrapping them in a validated ModelGraph.
 */

import { z } from 'zod';
import { Reason, Result, err, loadStructuredFile, ok, reason } from '../shared/index.js';
import { SystemModel } from './entities.js';
import { ModelGraph } from './graph.js';

function zodToReasons(error: z.ZodError): Reason[] {
  return error.issues.map((i) =>
    reason('MODEL_INVALID', `${i.path.join('.') || '<root>'}: ${i.message}`, {
      path: i.path.join('.'),
    }),
  );
}

export function validateModel(raw: unknown): Result<ModelGraph, Reason[]> {
  const parsed = SystemModel.safeParse(raw);
  if (!parsed.success) return err(zodToReasons(parsed.error));
  const graph = new ModelGraph(parsed.data);
  const integrity = graph.validate();
  if (integrity.length > 0) return err(integrity);
  return ok(graph);
}

export function loadModelFile(path: string, root?: string): Result<ModelGraph, Reason[]> {
  let raw: unknown;
  try {
    raw = loadStructuredFile(path, root ? { root } : {});
  } catch (e) {
    return err([reason('MALFORMED_INPUT', e instanceof Error ? e.message : String(e))]);
  }
  return validateModel(raw);
}
