/**
 * Compatibilidade F16.0 — o servidor OAuth é o de `src/integrations/handler.ts`.
 * A prova não mantém um segundo provedor. `createAgentProof` liga o
 * consentimento sintético só na suíte de protocolo.
 */

export {
  PROOF_REDIRECT_URI,
  PROOF_SCOPE,
  SYNTHETIC_SUBJECT,
  MemoryProofKv,
  MemoryKv,
  memoryKvOf,
  createAgentProof,
  createIntegrationHandler,
  handleAgentProof,
  handleIntegration,
  isAgentProofPath,
  isIntegrationPath,
} from '@/integrations/handler';

export type {
  AgentProof,
  CreateAgentProofOptions,
  ProofEnv,
  ProofExecutionContext,
  ProofKv,
} from '@/integrations/handler';
