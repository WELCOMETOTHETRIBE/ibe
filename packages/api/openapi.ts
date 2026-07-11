/**
 * OpenAPI 3.1 description of the IBE control-plane API (documented subset).
 */
export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Intent-Bound Execution — Assurance Control Plane',
    version: '0.2.0',
    description:
      'Deterministic assurance kernel over HTTP. Refusals return 422 with structured reasons; malformed input returns 400.',
  },
  paths: {
    '/health': { get: { summary: 'Liveness', responses: { '200': { description: 'ok' } } } },
    '/formal/check': {
      get: { summary: 'Run formal model checks', responses: { '200': {}, '422': {} } },
    },
    '/intents/validate': {
      post: { summary: 'Validate an Intent Contract v2', responses: { '200': {}, '422': {} } },
    },
    '/models/validate': {
      post: { summary: 'Validate a system model', responses: { '200': {}, '422': {} } },
    },
    '/models/diff': { post: { summary: 'Diff two models', responses: { '200': {} } } },
    '/policy/evaluate': {
      post: {
        summary: 'Evaluate policy for an intent+action',
        responses: { '200': {}, '422': {} },
      },
    },
    '/events/validate': {
      post: { summary: 'Validate a causal event trace', responses: { '200': {}, '422': {} } },
    },
    '/assurance/verify': {
      post: {
        summary: 'Verify a signed assurance certificate',
        responses: { '200': {}, '422': {} },
      },
    },
  },
} as const;
