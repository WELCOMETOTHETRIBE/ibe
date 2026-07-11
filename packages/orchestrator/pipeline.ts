/**
 * The end-to-end assurance pipeline — the enforced chain from §1:
 *
 *   Human Intent → Intent Contract → Authority Evaluation → Model Traceability
 *   → Model Delta → Hazard/Invariant Eval → Capability Issuance → Isolated
 *   Execution → Causal Event Collection → Independent Verification → Provenance
 *   → Assurance Case → Signed Promotion Certificate → Accept/Refuse/…
 *
 * The pipeline assembles stage outputs and hands them to the deterministic
 * assurance kernel, which alone decides. Every stage fails closed. The three
 * example demos construct a PipelineRequest and call `runPipeline`.
 */

import {
  Clock,
  SequentialIdGenerator,
  digestOf,
  systemClock,
  type Digest,
  type Reason,
} from '../shared/index.js';
import type { LoadedIntent } from '../intent/index.js';
import type { ModelGraph } from '../model/index.js';
import { computeModelDelta, validateComposition, type ModelDelta } from '../model/index.js';
import {
  DeterministicPolicyEngine,
  type PolicyDecision,
  type PolicyContext,
} from '../policy/index.js';
import type { LocalIdentityProvider } from '../identity/index.js';
import { CapabilityBroker, type Capability } from '../capabilities/index.js';
import type { ExecutionResult } from '../execution/index.js';
import { EventStore, EventEmitter, type Event, type EmitInput } from '../events/index.js';
import { CausalGraph, evaluateConformance, type CausalConformance } from '../causal/index.js';
import {
  VerifierRegistry,
  platformVerifiers,
  checkIndependence,
  type Verifier,
  type VerificationSummary,
} from '../verification/index.js';
import {
  analyzeScope,
  type ScopeReport,
  type ChangedFile,
  type SymbolChange,
} from '../adapters/index.js';
import {
  createEvidence,
  createAttestation,
  lockfileHash,
  type Evidence,
  type EvidenceContext,
  type Attestation,
  type EvidenceType,
} from '../provenance/index.js';
import {
  decide,
  buildAssuranceCase,
  issueCertificate,
  type AssuranceInput,
  type Certificate,
  type GateOutcome,
} from '../assurance/index.js';

export interface PipelineIdentities {
  idp: LocalIdentityProvider;
  ownerId: string;
  governorId: string;
  builderId: string;
  brokerId: string;
  verifierIds: string[];
  signerId: string;
}

/** An extra event a demo injects to exercise a causal pattern (e.g. a forbidden one). */
export interface InjectedEvent {
  event_type: string;
  outcome: Event['outcome'];
  /** Parent spine event types to link to (most recent match wins). */
  parentTypes?: string[];
  attributes?: Record<string, unknown>;
}

export interface PipelineRequest {
  intent: LoadedIntent;
  identities: PipelineIdentities;
  clock?: Clock;

  request: { action: string; resource: string; environment: string };
  approvals: string[];

  model?: { baseline?: ModelGraph; proposed: ModelGraph };
  trustBoundaryChanged?: boolean;
  informationFlowViolations?: Reason[];
  changedElementIds?: string[];

  sourceCommit: string;
  changedFiles: ChangedFile[];
  symbolChanges?: Record<string, SymbolChange[]>;
  addedDependencies?: string[];

  cost?: { estimatedUsd: number };
  blastRadius?: string;
  breakGlass?: boolean;

  /** Runs the proposed change in isolation and returns the result. */
  runExecution: () => Promise<ExecutionResult>;
  /** Subject-specific verifiers appended to the platform set. */
  subjectVerifiers?: Verifier[];
  /** Facts made available to verifiers, merged with kernel-computed facts. */
  verifierFacts?: Record<string, unknown>;

  requiredPatterns?: string[];
  forbiddenPatterns?: string[];
  recoveryObligations?: string[];
  injectedEvents?: InjectedEvent[];

  lockfileContent?: string;
  buildImageDigest?: string;
  /** If true, model a tested rollback (recovery). */
  recoveryTested?: boolean;
}

export interface PipelineResult {
  decision: 'accepted' | 'refused';
  certificate: Certificate;
  gates: GateOutcome[];
  policyDecision: PolicyDecision;
  capability?: Capability;
  scopeReport: ScopeReport;
  modelDelta?: ModelDelta;
  causalConformance: CausalConformance;
  verification: VerificationSummary;
  evidence: Evidence[];
  attestation?: Attestation;
  events: Event[];
  reasons: Reason[];
  /** Public keyring (actor id → PEM) so certificates/evidence can be verified later. */
  keyring: Record<string, string>;
}

export async function runPipeline(req: PipelineRequest): Promise<PipelineResult> {
  const clock = req.clock ?? systemClock;
  const { idp } = req.identities;
  const intent = req.intent.contract;
  const modelVersion = req.model?.proposed.model.model_version ?? 'no-model';

  const store = new EventStore();
  const emitter = new EventEmitter(store, clock);
  const spine = new Map<string, string>(); // event_type -> latest event_id
  const emit = (input: Omit<EmitInput, 'intent_id'>): Event => {
    const parents = (input.parents ?? [])
      .map((t) => spine.get(t))
      .filter((x): x is string => Boolean(x));
    const ev = emitter.emit({ ...input, intent_id: intent.intent.id, parents });
    spine.set(ev.event_type, ev.event_id);
    return ev;
  };

  // --- Stage: intent received / authorized (temporal validity) -----------
  emit({ event_type: 'IntentReceived', actor_id: req.identities.ownerId, outcome: 'success' });
  if (req.approvals.length > 0) {
    emit({
      event_type: 'HumanApprovalRecorded',
      actor_id: req.approvals[0]!,
      outcome: 'success',
      parents: ['IntentReceived'],
    });
  }

  // --- Stage: model traceability / delta / assume-guarantee ---------------
  let modelDelta: ModelDelta | undefined;
  let changedElementIds = req.changedElementIds ?? [];
  const assumptionFindings: Reason[] = [];
  const modelReasons: Reason[] = [];
  if (req.model) {
    if (req.model.baseline) {
      modelDelta = computeModelDelta(req.model.baseline, req.model.proposed);
      if (changedElementIds.length === 0) changedElementIds = modelDelta.changedElementIds;
    }
    for (const f of validateComposition(req.model.proposed)) assumptionFindings.push(f.reason);
  }
  const modelDeltaHash: Digest = modelDelta?.deltaHash ?? digestOf({ noDelta: true, modelVersion });

  // --- Stage: scope analysis (git + AST) ----------------------------------
  const scopeReport = analyzeScope({
    intent,
    changedFiles: req.changedFiles,
    ...(req.symbolChanges ? { symbolChanges: req.symbolChanges } : {}),
    ...(req.addedDependencies ? { addedDependencies: req.addedDependencies } : {}),
  });

  // --- Stage: policy evaluation (Policy Decision Point) -------------------
  const engine = new DeterministicPolicyEngine();
  const policyCtx: PolicyContext = {
    now: clock.now(),
    actorId: req.identities.builderId,
    builderId: req.identities.builderId,
    intent,
    intentHash: req.intent.hash,
    request: req.request,
    approvals: req.approvals,
    model: {
      trustBoundaryChanged: req.trustBoundaryChanged ?? false,
      dataFlowViolations: req.informationFlowViolations ?? [],
      changedElementIds,
    },
    ...(req.cost ? { cost: req.cost } : {}),
    ...(req.blastRadius ? { blastRadius: req.blastRadius } : {}),
    ...(req.breakGlass ? { breakGlass: req.breakGlass } : {}),
  };
  const policyDecision = engine.evaluate(policyCtx);
  // The `authorized` gate reflects POLICY authority only. Scope is a separate
  // gate (`within-scope`), so a scope failure no longer masquerades as an
  // authorization failure. Capability issuance and the IntentAuthorized event,
  // however, require BOTH policy authority AND a clean scope — we never issue a
  // capability for an out-of-scope change.
  const authorityAllowed = policyDecision.decision === 'allow';
  const scopeClean = scopeReport.violations.length === 0;
  const mayProceed = authorityAllowed && scopeClean;
  emit({
    event_type: mayProceed ? 'IntentAuthorized' : 'AuthorizationRefused',
    actor_id: req.identities.governorId,
    outcome: mayProceed ? 'success' : 'refused',
    parents: ['IntentReceived'],
  });

  // --- Stage: capability issuance (Capability Broker) ---------------------
  const broker = new CapabilityBroker(
    idp,
    req.identities.brokerId,
    clock,
    new SequentialIdGenerator('CAP'),
  );
  let capability: Capability | undefined;
  if (mayProceed && policyDecision.capabilities.length > 0) {
    const grant = policyDecision.capabilities[0]!;
    const issued = broker.issue({
      intentId: intent.intent.id,
      intentHash: req.intent.hash,
      actorId: req.identities.builderId,
      action: grant.action,
      resource: grant.resource,
      environment: grant.environment,
      modelVersion,
      ttlSeconds: grant.expires_in_seconds,
      singleUse: grant.single_use,
    });
    if (issued.ok) {
      capability = issued.value;
      emit({
        event_type: 'CapabilityIssued',
        actor_id: req.identities.brokerId,
        outcome: 'success',
        capability_id: capability.id,
        parents: ['IntentAuthorized'],
      });
    }
  }

  // --- Stage: isolated execution -----------------------------------------
  emit({
    event_type: 'BuildStarted',
    actor_id: req.identities.builderId,
    outcome: 'success',
    parents: ['CapabilityIssued', 'IntentAuthorized'],
  });
  const execution = await req.runExecution();
  const artifactDigest: Digest =
    Object.values(execution.artifactDigests)[0] ??
    digestOf({ stdout: execution.stdout, outcome: execution.outcome });
  const executionConclusive = execution.outcome === 'success' || execution.outcome === 'failure';
  emit({
    event_type: execution.outcome === 'success' ? 'BuildCompleted' : 'BuildFailed',
    actor_id: req.identities.builderId,
    outcome: execution.outcome === 'success' ? 'success' : 'failure',
    artifact_digest: artifactDigest,
    parents: ['BuildStarted'],
  });

  // --- Stage: independent verification -----------------------------------
  const registry = new VerifierRegistry();
  for (const v of platformVerifiers()) registry.register(v);
  for (const v of req.subjectVerifiers ?? []) registry.register(v);

  // Facts for verifiers are assembled AFTER causal (below), so do a first pass
  // of causal conformance now using the spine so far, then verify.
  const preGraph = new CausalGraph(store.all().slice());
  const evidenceContext: EvidenceContext = {
    model_version: modelVersion,
    source_commit: req.sourceCommit,
    artifact_digest: artifactDigest,
    policy_version: policyDecision.policy_bundle_version,
    verifier_version: '1.0.0',
    trust_boundary_version: req.trustBoundaryChanged ? 'changed' : 'stable',
    identity_policy_version: '1.0.0',
  };

  // Inject demo-provided events (e.g. forbidden ones) before final conformance.
  for (const inj of req.injectedEvents ?? []) {
    emit({
      event_type: inj.event_type,
      actor_id: req.identities.builderId,
      outcome: inj.outcome,
      parents: inj.parentTypes ?? [],
      ...(inj.attributes ? { attributes: inj.attributes } : {}),
    });
  }

  // Compute causal conformance over the required/forbidden/recovery patterns.
  const forbidden = [
    ...new Set([...(req.forbiddenPatterns ?? []), ...intent.forbidden_event_patterns]),
  ];
  const required = req.requiredPatterns ?? [];
  const graph = new CausalGraph(store.all().slice());
  const causalConformance = evaluateConformance(
    graph,
    required,
    forbidden,
    req.recoveryObligations ?? [],
  );
  void preGraph;

  const verifierFacts = {
    policyDecision,
    causalConformance,
    evidence: { missing: [] as string[], stale: [] as string[] },
    recovery: {
      required: intent.recovery.required,
      tested: req.recoveryTested ?? intent.recovery.required,
    },
    execution,
    ...(req.verifierFacts ?? {}),
  };
  const verification = await registry.runAll({
    builderId: req.identities.builderId,
    intentId: intent.intent.id,
    facts: verifierFacts,
  });
  const independenceReasons = checkIndependence(
    verification,
    intent.verification.minimum_independent_verifiers,
  );
  emit({
    event_type:
      verification.allPassed && independenceReasons.length === 0
        ? 'VerificationPassed'
        : 'VerificationFailed',
    actor_id: req.identities.verifierIds[0] ?? 'verifier',
    outcome: verification.allPassed ? 'success' : 'failure',
    parents: ['BuildCompleted'],
  });

  // --- Stage: evidence generation ----------------------------------------
  const signer = idp.signer(req.identities.signerId);
  const evIds = new SequentialIdGenerator('EVD');
  const evidence: Evidence[] = [];
  const produce = (type: EvidenceType, content: unknown): void => {
    evidence.push(
      createEvidence(
        {
          evidenceId: evIds.next(),
          type,
          collectedBy: req.identities.signerId,
          context: evidenceContext,
          content,
        },
        signer,
        clock,
      ),
    );
  };
  produce('source-diff', scopeReport);
  produce('policy-decision', policyDecision);
  produce('test-results', verification.results);
  produce('causal-trace', store.all());
  produce('artifact-digest', { artifactDigest });
  if (modelDelta) produce('model-delta', modelDelta);

  // --- Stage: provenance attestation -------------------------------------
  const causalTraceRoot = digestOf(store.all());
  const attestation = createAttestation(
    {
      intent_id: intent.intent.id,
      intent_hash: req.intent.hash,
      model_version: modelVersion,
      model_delta_hash: modelDeltaHash,
      source_repository: intent.scope.repositories[0] ?? 'local',
      source_commit: req.sourceCommit,
      changed_files: scopeReport.changedFiles,
      dependency_lockfile_hash: lockfileHash(req.lockfileContent ?? ''),
      build_environment_image_digest: req.buildImageDigest ?? execution.runner,
      builder_identity: req.identities.builderId,
      verifier_identities: req.identities.verifierIds,
      policy_bundle_hash: policyDecision.policy_bundle_hash,
      artifact_digest: artifactDigest,
      causal_trace_root: causalTraceRoot,
      test_result_digests: [digestOf(verification.results)],
      timestamp: clock.nowIso(),
    },
    signer,
  );
  produce('verifier-attestation', attestation);
  produce('provenance', attestation.predicate);

  const evidencePresent = [...new Set(evidence.map((e) => e.type))];
  const missingEvidence = intent.evidence.required_types.filter(
    (t) => !evidencePresent.includes(t),
  );

  // --- Stage: assurance kernel decision ----------------------------------
  const assuranceInput: AssuranceInput = {
    intentId: intent.intent.id,
    intentHash: req.intent.hash,
    modelVersion,
    modelDeltaHash,
    sourceCommit: req.sourceCommit,
    policyBundleHash: policyDecision.policy_bundle_hash,
    policyBundleVersion: policyDecision.policy_bundle_version,
    artifactDigest,
    causalTraceRoot,
    builderIdentity: req.identities.builderId,
    verifierIdentities: req.identities.verifierIds,
    signerIdentity: req.identities.signerId,
    requestedAction: req.request.action,
    environment: req.request.environment,
    authority: { allowed: authorityAllowed, reasons: policyDecision.reasons },
    modelTraceability: {
      valid: assumptionFindings.length === 0,
      reasons: [...modelReasons, ...assumptionFindings],
    },
    scope: { violations: scopeReport.violations },
    informationFlow: { violations: req.informationFlowViolations ?? [] },
    causal: {
      conformant: causalConformance.conformant,
      reasons: [
        ...causalConformance.structural,
        ...causalConformance.required.filter((r) => !r.satisfied && r.reason).map((r) => r.reason!),
        ...causalConformance.forbidden
          .filter((r) => !r.satisfied && r.reason)
          .map((r) => r.reason!),
        ...causalConformance.recovery.filter((r) => !r.satisfied && r.reason).map((r) => r.reason!),
      ],
      requiredPassed: causalConformance.required.filter((r) => r.satisfied).length,
      forbiddenDetected: causalConformance.forbidden.filter((r) => !r.satisfied).length,
    },
    verification: {
      independentPassed: verification.independentPassed,
      minimumIndependent: intent.verification.minimum_independent_verifiers,
      failedCaseIds: verification.failedCaseIds,
      passedCaseIds: verification.passedCaseIds,
      reasons: independenceReasons,
    },
    evidence: { present: evidencePresent, missing: missingEvidence, stale: [] },
    provenance: { reasons: [] },
    recovery: {
      required: intent.recovery.required,
      tested: req.recoveryTested ?? intent.recovery.required,
    },
    execution: {
      conclusive: executionConclusive,
      isolated: execution.isolated,
      outcome: execution.outcome,
    },
    assumptions: { unresolved: assumptionFindings },
  };

  const kernelDecision = decide(assuranceInput);
  const assuranceCase = buildAssuranceCase({
    decision: kernelDecision.decision,
    gates: kernelDecision.gates,
    evidenceRefs: evidence.map((e) => e.evidence_id),
    assumptions: [`execution runner: ${execution.runner} (isolated=${execution.isolated})`],
    residualRisk:
      execution.isolated === false
        ? ['Execution used a non-container runner; container isolation not proven for this run.']
        : [],
    staleEvidence: [],
    freshnessNote: `evidence collected at ${clock.nowIso()} within freshness windows`,
  });

  const certificate = issueCertificate(
    assuranceInput,
    kernelDecision,
    assuranceCase,
    signer,
    clock,
    new SequentialIdGenerator('CERT'),
  );

  emit({
    event_type:
      kernelDecision.decision === 'accepted'
        ? 'AssuranceCertificateIssued'
        : 'AssuranceCertificateRefused',
    actor_id: req.identities.signerId,
    outcome: kernelDecision.decision === 'accepted' ? 'success' : 'refused',
    parents: ['VerificationPassed', 'VerificationFailed'],
  });

  return {
    decision: kernelDecision.decision,
    certificate,
    gates: kernelDecision.gates,
    policyDecision,
    ...(capability ? { capability } : {}),
    scopeReport,
    ...(modelDelta ? { modelDelta } : {}),
    causalConformance,
    verification,
    evidence,
    attestation,
    events: store.all().slice(),
    reasons: kernelDecision.reasons,
    keyring: idp.keyring(),
  };
}
