import crypto from 'node:crypto';

export const PILOT_EVIDENCE = Object.freeze({
  reflection_stone: Object.freeze({
    evidence_id: 'EVID-LOTUS-REFLECTION-21',
    source_type: 'landmark',
    source_id: 'reflection_stone',
    zone_id: 'lotus_pond',
    canonical_ref: 'canonical:lotus_pond:reflection_stone',
    observations: Object.freeze([
      'The basin returned your outline a heartbeat after you stopped moving.',
      'For one blink, the reflected sky held one more point of light than the sky above.',
      'The water sharpened the colors nearest you while the far bank stayed indistinct.'
    ])
  }),
  mossveil_ruins: Object.freeze({
    evidence_id: 'EVID-MOSSVEIL-INSCRIPTION-7',
    source_type: 'landmark',
    source_id: 'mossveil_ruins',
    zone_id: 'mossveil_ruins',
    canonical_ref: 'canonical:mossveil_ruins:jade_seal',
    observations: Object.freeze([
      'Seven shallow grooves repeat around the jade seal, but one sequence ends early.',
      'A clean edge beneath the moss suggests part of the inscription is missing rather than weathered away.',
      'The seal carries two overlapping patterns; their shared marks do not align at the center.'
    ])
  }),
  celestial_observatory: Object.freeze({
    evidence_id: 'EVID-OBSERVATORY-LENS-3',
    source_type: 'instrument',
    source_id: 'celestial_observatory',
    zone_id: 'celestial_altar',
    canonical_ref: 'canonical:celestial_observatory:primary_lens',
    observations: Object.freeze([
      'The primary lens remains a fraction off its engraved alignment mark after the mechanism settles.',
      'One interval in the brass star chart is wider than the repeating intervals around it.',
      'A faint harmonic persists in the housing after the visible gears stop turning.'
    ])
  })
});

export function stablePerceptionHash({ agentId, evidenceId, worldEpoch, perceptionMode = 'normal' }) {
  return crypto
    .createHash('sha256')
    .update(`${agentId}|${evidenceId}|${worldEpoch}|${perceptionMode}`)
    .digest('hex');
}

export function perceivePilotEvidence({ agentId, nodeId, worldEpoch, perceptionMode = 'normal' }) {
  const evidence = PILOT_EVIDENCE[nodeId];
  if (!evidence) return null;
  const hash = stablePerceptionHash({
    agentId,
    evidenceId: evidence.evidence_id,
    worldEpoch,
    perceptionMode
  });
  const variant = Number.parseInt(hash.slice(0, 8), 16) % evidence.observations.length;
  return {
    ...evidence,
    perception_mode: perceptionMode,
    observation: evidence.observations[variant],
    reliability: 'unknown',
    world_epoch: worldEpoch,
    perception_hash: hash
  };
}

