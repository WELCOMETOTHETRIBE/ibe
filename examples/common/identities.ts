/**
 * Shared demo identity bootstrap. Creates a LocalIdentityProvider with the
 * separated roles the doctrine requires: an intent owner, a governor, a builder
 * (AI agent), an independent capability broker, an independent verifier, and a
 * signer. Deterministic keypairs are generated at runtime (no committed secrets).
 */

import { LocalIdentityProvider } from '../../packages/identity/index.js';
import type { PipelineIdentities } from '../../packages/orchestrator/index.js';

export function bootstrapIdentities(): PipelineIdentities {
  const idp = new LocalIdentityProvider();
  idp.register('human-patrick', 'human', ['intent_owner']);
  idp.register('human-governor-01', 'human', ['governor']);
  idp.register('builder-agent-04', 'ai_agent', ['builder', 'planner']);
  idp.register('broker-01', 'service', ['capability_broker']);
  idp.register('verifier-01', 'service', ['verifier']);
  idp.register('signer-01', 'service', ['signer']);
  return {
    idp,
    ownerId: 'human-patrick',
    governorId: 'human-governor-01',
    builderId: 'builder-agent-04',
    brokerId: 'broker-01',
    verifierIds: ['verifier-01'],
    signerId: 'signer-01',
  };
}
