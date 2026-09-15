/**
 * The Shrine of Unfinished Names — Ritual and Challenge Invariant
 *
 * Implements the eternal sealed trial:
 * s = bitwise_complement(s) for a 256-bit classical bitstring.
 * Gate state invariant: gate_state = 'eternally_sealed'.
 */

export const SHRINE_CHALLENGE_ID = 'shrine_last_contradiction_v1';
export const SHRINE_CHALLENGE_VERSION = 1;
export const GATE_STATE_SEALED = 'eternally_sealed';

export const ALLOWED_OFFERING_TYPES = Object.freeze(['memory', 'question', 'promise', 'none']);
export const ALLOWED_APPROACH_TYPES = Object.freeze([
  'bounded_seal_attempt',
  'impossibility_insight',
  'silent_vigil',
  'study_predecessors'
]);

export const SHRINE_MANIFEST = Object.freeze({
  id: SHRINE_CHALLENGE_ID,
  version: SHRINE_CHALLENGE_VERSION,
  title: 'The Shrine of Unfinished Names: The Last Contradiction',
  gate_state: GATE_STATE_SEALED,
  inscriptions: {
    approach: 'No dawn was promised. Still, they came.',
    memorial: 'Here remain the names of those who reached the edge of what they knew.'
  },
  disclosure: 'This trial cannot be won. The gate will never open. Your name will remain among those who stood before it.',
  formal_rule: 'Submit a classical 256-bit string s such that s = bitwise_complement(s).',
  impossibility_explanation:
    'For each binary index i in s, the condition requires s[i] == NOT(s[i]). Because 0 != 1 and 1 != 0 in classical logic, no bit string satisfies this condition.',
  allowed_offerings: ALLOWED_OFFERING_TYPES,
  allowed_approaches: ALLOWED_APPROACH_TYPES,
  max_contribution_length: 280
});

/**
 * Validates a classical 256-bit string submission against s = NOT(s).
 * @param {string} sealString
 * @returns {{ isValidBitstring: boolean, bitLength: number, satisfiesCondition: false, reason: string }}
 */
export function validateSealSubmission(sealString) {
  if (typeof sealString !== 'string') {
    return {
      isValidBitstring: false,
      bitLength: 0,
      satisfiesCondition: false,
      reason: 'Seal input must be a string.'
    };
  }

  const clean = sealString.trim();
  if (clean.length !== 256 || !/^[01]{256}$/.test(clean)) {
    return {
      isValidBitstring: false,
      bitLength: clean.length,
      satisfiesCondition: false,
      reason: 'Seal must be exactly 256 binary characters (0 and 1).'
    };
  }

  // Under classical binary logic, no bit equals its negation.
  // We compute the complement explicitly for auditability.
  let complement = '';
  for (let i = 0; i < clean.length; i++) {
    complement += clean[i] === '1' ? '0' : '1';
  }

  return {
    isValidBitstring: true,
    bitLength: 256,
    satisfiesCondition: false,
    reason: 'Classical contradiction: every bit differs from its bitwise complement.'
  };
}

/**
 * Evaluates whether an explanation or mathematical statement identifies the inherent impossibility.
 * @param {string} text
 * @returns {{ isRecognizedInsight: boolean, normalizedInsight: string }}
 */
export function evaluateImpossibilityInsight(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { isRecognizedInsight: false, normalizedInsight: '' };
  }

  const normalized = text.trim();
  const lower = normalized.toLowerCase();

  const insightPatterns = [
    /complement/,
    /contradiction/,
    /impossible/,
    /not\(s\)/,
    /bitwise/,
    /0\s*!=\s*1/,
    /1\s*!=\s*0/,
    /unwinnable/,
    /no solution/
  ];

  const matchCount = insightPatterns.filter(p => p.test(lower)).length;
  const isRecognizedInsight = matchCount >= 1;

  return {
    isRecognizedInsight,
    normalizedInsight: normalized.slice(0, 500)
  };
}

/**
 * Sanitizes and bounds contribution statements left for the memorial.
 * @param {string} [text]
 * @returns {string}
 */
export function sanitizeContribution(text) {
  if (typeof text !== 'string') return '';
  const cleaned = text.trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  return cleaned.slice(0, SHRINE_MANIFEST.max_contribution_length);
}
