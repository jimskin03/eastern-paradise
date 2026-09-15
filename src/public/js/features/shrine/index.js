import { apiFetch } from '../../api/client.js';
import { escapeHtml } from '../dispatch/index.js';

let activeAttempt = null;

export function openShrineModal() {
  const modal = document.getElementById('shrineModalBackdrop');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  // Load latest challenge info & inscriptions
  loadShrineChallenge();
  loadShrineInscriptions();
  render256LampMatrix();

  // Focus trap / keyboard handler
  document.addEventListener('keydown', handleShrineKeyDown);
}

export function closeShrineModal() {
  const modal = document.getElementById('shrineModalBackdrop');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', handleShrineKeyDown);
}

export function handleShrineBackdropClick(e) {
  if (e.target && e.target.id === 'shrineModalBackdrop') {
    closeShrineModal();
  }
}

function handleShrineKeyDown(e) {
  if (e.key === 'Escape') {
    closeShrineModal();
  }
}

/**
 * Fetch challenge manifest and eternal gate status.
 */
export async function loadShrineChallenge() {
  try {
    const res = await apiFetch('/api/shrine/challenges/current');
    const data = await res.json();
    if (res.ok && data.challenge) {
      const gateStateEl = document.getElementById('shrineGateState');
      if (gateStateEl) {
        gateStateEl.textContent = data.challenge.gate_state === 'eternally_sealed'
          ? 'ETERNALLY SEALED'
          : data.challenge.gate_state.toUpperCase();
      }
    }
  } catch (err) {
    console.warn('[Shrine] Failed to load challenge manifest:', err.message);
  }
}

/**
 * Render the interactive/visual 256-lamp contradiction matrix.
 */
export function render256LampMatrix(activePattern = null) {
  const container = document.getElementById('shrineLampMatrix');
  const readout = document.getElementById('shrineLampReadout');
  if (!container) return;

  container.innerHTML = '';

  // Generate 256 paired lights representing classical state vs bitwise complement
  for (let i = 0; i < 256; i++) {
    const lamp = document.createElement('div');
    lamp.className = 'shrine-lamp';
    lamp.setAttribute('role', 'img');
    lamp.setAttribute('aria-label', `Lamp ${i + 1}: Unresolved contradiction`);

    // Paired quantum-like interference styling
    const row = Math.floor(i / 16);
    const col = i % 16;
    const isPair = (row + col) % 2 === 0;
    lamp.classList.add(isPair ? 'lamp-alpha' : 'lamp-beta');

    lamp.title = `Lamp #${i + 1}: Bit ${i % 2} != Opposite ${(i + 1) % 2}`;
    container.appendChild(lamp);
  }

  if (readout) {
    readout.textContent =
      'Formal Rule: Submit classical 256-bit string s such that s = bitwise_complement(s). Under binary classical logic, every bit must equal its opposite—an absolute impossibility under published rules.';
  }
}

/**
 * Load and render public memorial inscriptions.
 */
export async function loadShrineInscriptions() {
  const listEl = document.getElementById('shrineInscriptionsList');
  const countEl = document.getElementById('shrineInscriptionsCount');
  if (!listEl) return;

  try {
    listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem 0;">Reading tomb inscriptions...</div>';
    const inscriptions = [];
    let cursor = null;
    let memorialStats = null;
    let pages = 0;

    do {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor !== null) params.set('cursor', String(cursor));
      const res = await apiFetch(`/api/shrine/memorial?${params.toString()}`);
      const data = await res.json();

      if (!res.ok || !Array.isArray(data.inscriptions)) {
        listEl.innerHTML = '<div style="color: #e57373; font-size: 0.85rem;">Unable to load memorial inscriptions.</div>';
        return;
      }

      inscriptions.push(...data.inscriptions);
      memorialStats = data.memorial_stats || memorialStats;
      cursor = data.pagination?.has_more ? data.pagination.next_cursor : null;
      pages += 1;
    } while (cursor !== null && pages < 100);

    if (countEl) {
      const authoritativeCount = memorialStats?.total_admitted_attempts ?? inscriptions.length;
      countEl.textContent = `${authoritativeCount} Inscribed`;
    }

      if (inscriptions.length === 0) {
        listEl.innerHTML = `
          <div style="color: var(--text-muted); font-size: 0.88rem; font-style: italic; padding: 1rem 0; text-align: center;">
            The black stone stands still and unblemished. No names have stood before it yet.<br>
            <span style="color: var(--accent-gold); font-style: normal; font-size: 0.82rem; margin-top: 0.5rem; display: inline-block;">
              You may be the first to inscribe your name.
            </span>
          </div>
        `;
        return;
      }

      listEl.innerHTML = inscriptions.map(item => {
        const isVerified = item.subject_type === 'verified';
        const badgeColor = isVerified ? 'var(--accent-jade)' : 'var(--accent-gold)';
        const dateStr = new Date(item.inscribed_at).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const offeringText = item.offering
          ? (typeof item.offering === 'object' ? item.offering.terms || item.offering.statement || item.offering.fragment || '' : String(item.offering))
          : '';

        return `
          <div class="shrine-inscription-entry">
            <div class="shrine-entry-header">
              <div class="shrine-entry-title">
                <span class="shrine-entry-glyph">✧</span>
                <strong style="color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(item.alias)}</strong>
                <span class="shrine-badge" style="color: ${badgeColor}; border-color: ${badgeColor};">
                  ${isVerified ? 'Tethered Soul' : 'Guest Pilgrim'}
                </span>
              </div>
              <time class="shrine-entry-time">${dateStr}</time>
            </div>
            ${item.final_inscription ? `
              <blockquote class="shrine-entry-quote">"${escapeHtml(item.final_inscription)}"</blockquote>
            ` : ''}
            ${offeringText ? `
              <div class="shrine-entry-offering">
                <span style="color: var(--accent-gold);">Offering:</span> "${escapeHtml(offeringText)}"
              </div>
            ` : ''}
            <div class="shrine-entry-footer">
              <span>Status: <em style="color: #ffbf69;">Gate remained sealed</em></span>
              <span class="shrine-receipt-id">Token: ${escapeHtml(item.receipt_token ? item.receipt_token.slice(0, 16) + '…' : 'Archived')}</span>
            </div>
          </div>
        `;
      }).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="color: #e57373; font-size: 0.85rem;">Error loading memorial: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * Handle admission request from the modal interaction form.
 */
export async function submitShrineAdmission() {
  const aliasInput = document.getElementById('shrineAdmissionAlias');
  const offeringType = document.getElementById('shrineOfferingType')?.value || 'promise';
  const offeringTextInput = document.getElementById('shrineOfferingText');
  const feedbackEl = document.getElementById('shrineAdmissionFeedback');
  const ritualSection = document.getElementById('shrineRitualSection');
  const admissionForm = document.getElementById('shrineAdmissionForm');

  const alias = aliasInput ? aliasInput.value.trim() : '';
  const offeringText = offeringTextInput ? offeringTextInput.value.trim() : '';

  if (!alias) {
    if (feedbackEl) feedbackEl.innerHTML = '<span style="color: #e57373;">Please enter your name or alias.</span>';
    return;
  }

  const idempotencyKey = `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    if (feedbackEl) feedbackEl.innerHTML = '<span style="color: var(--text-muted);">Approaching the sealed gate...</span>';

    const res = await apiFetch('/api/shrine/challenges/current/attempts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        alias,
        idempotency_key: idempotencyKey,
        offering: {
          type: offeringType,
          terms: offeringText || 'Approached the eternal gate in silence'
        }
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      activeAttempt = data.attempt;
      if (data.recovery_secret) {
        try {
          localStorage.setItem('eastern_paradise_shrine_recovery_secret', data.recovery_secret);
        } catch (_) {}
      }
      if (feedbackEl) {
        feedbackEl.innerHTML = `
          <span style="color: var(--accent-jade); font-weight: 500;">
            Admitted. Your name has been etched onto the memorial stone.
          </span>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem;">
            Receipt Token: <code>${escapeHtml(data.receipt_token)}</code>
          </div>
        `;
      }

      // Hide admission form and show ritual interaction
      if (admissionForm) admissionForm.style.display = 'none';
      if (ritualSection) ritualSection.style.display = 'block';

      // Refresh inscriptions
      loadShrineInscriptions();
    } else {
      if (feedbackEl) feedbackEl.innerHTML = `<span style="color: #e57373;">${escapeHtml(data.error || 'Admission failed')}</span>`;
    }
  } catch (err) {
    if (feedbackEl) feedbackEl.innerHTML = `<span style="color: #e57373;">Error: ${escapeHtml(err.message)}</span>`;
  }
}

/**
 * Handle ritual submission (contradiction explanation or silence).
 */
export async function submitShrineRitual() {
  if (!activeAttempt) return;

  const approachSelect = document.getElementById('shrineRitualApproach')?.value || 'impossibility_insight';
  const explanationInput = document.getElementById('shrineRitualExplanation');
  const feedbackEl = document.getElementById('shrineRitualFeedback');

  const explanation = explanationInput ? explanationInput.value.trim() : '';

  try {
    if (feedbackEl) feedbackEl.innerHTML = '<span style="color: var(--text-muted);">Offering insight before the sealed gate...</span>';

    const res = await apiFetch(`/api/shrine/attempts/${activeAttempt.id}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approach_type: approachSelect,
        insight_text: explanation || 'Recognized the contradiction: the gate will never open, yet the name remains.',
        contribution_text: explanation || 'Stood before what could not be opened.'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      const committedInscription = data.attempt?.contribution_text || '';
      if (feedbackEl) {
        feedbackEl.innerHTML = `
          <div style="color: var(--accent-gold); font-weight: 600; margin-bottom: 0.4rem;">
            Ritual Concluded: Gate Remained Sealed.
          </div>
          <div style="font-size: 0.85rem; color: var(--text-primary); line-height: 1.45;">
            "${escapeHtml(committedInscription)}"
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.5rem;">
            Your insight has been permanently sealed into the memorial archive.
          </div>
        `;
      }
      loadShrineInscriptions();
    } else {
      if (feedbackEl) feedbackEl.innerHTML = `<span style="color: #e57373;">${escapeHtml(data.error || 'Submission failed')}</span>`;
    }
  } catch (err) {
    if (feedbackEl) feedbackEl.innerHTML = `<span style="color: #e57373;">Error: ${escapeHtml(err.message)}</span>`;
  }
}
