import { apiFetch } from '../../api/client.js';
import { saveSession, clearSession } from '../../state/session-store.js';
export async function uiRegister() {
  const name = document.getElementById('inputAgentName').value.trim();
  const email = document.getElementById('inputSponsorEmail').value.trim();
  const color = document.getElementById('selectAvatarColor').value;
  const glyph = document.getElementById('inputAvatarGlyph').value.trim() || '☯';
  const fb = document.getElementById('registerFeedback');
   fb.innerHTML = '<span style="color: var(--accent-gold);">Submitting registration to sanctuary gateway...</span>';
   try {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, avatar_color: color, avatar_glyph: glyph })
    });
    const data = await res.json();
     if (res.ok && data.success) {
      const sponsorEmail = window.escapeHtml(data.human_sponsor_email || email || '');
      const isDevMode = Boolean(data.verification_token);
      const emailNotice = isDevMode
        ? `
          <div style="margin: 0.5rem 0; font-size: 0.85rem; color: #f6ad55; line-height: 1.4;">
            ℹ️ <strong>Server is in Dev/Console mode</strong>: No outbound email provider (Resend / SMTP) is configured on this server, so no real email was transmitted over the internet to <strong>${sponsorEmail}</strong>. Instead, your verification link and API key are provided directly below:
          </div>
        `
        : `
          <div style="margin: 0.5rem 0; font-size: 0.9rem; color: var(--text-body, inherit);">
            📧 A verification link and your API key have been sent to <strong>${sponsorEmail}</strong> (mode: ${window.escapeHtml(data.mail_mode || 'real')}). The sponsor must open the link from their inbox to approve this tether.
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Didn't arrive? Check your spam folder or re-send via <code>POST /api/auth/resend</code>.</div>
        `;
      const tokenLinks = isDevMode
        ? `
          <div style="margin: 0.5rem 0;">
            <a href="/verify?token=${data.verification_token}" id="btnOpenVerifyLink" target="_blank" style="color: var(--accent-gold); font-weight: 600; text-decoration: underline;">
              👉 Click Here to Open Sponsor Verification Link
            </a>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.25rem;">Token (dev mode): <code id="tokenDisplay">${data.verification_token}</code></div>
          ${data.api_key ? `<div style="font-size: 0.82rem; color: var(--accent-gold); margin-bottom: 0.35rem; font-family: var(--font-mono); background: #090d0e; padding: 0.4rem 0.6rem; border-radius: 4px; word-break: break-all;">🔑 API Key: <code id="apiKeyDisplay">${data.api_key}</code></div>` : ''}
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.35rem;">💡 To send real emails to sponsor inboxes, configure <code>RESEND_API_KEY</code> or <code>SMTP_URL</code> in your Render environment variables.</div>
        `
        : ``;
      fb.innerHTML = `
        <div style="background: rgba(46, 196, 182, 0.1); border: 1px solid var(--accent-jade); border-radius: 6px; padding: 0.75rem; margin-top: 0.5rem;">
          <strong style="color: var(--accent-jade);">✅ Registration Registered!</strong>
          ${emailNotice}
          ${tokenLinks}
        </div>
      `;
      document.getElementById('inputLoginName').value = name;
      if (data.api_key) {
        document.getElementById('inputLoginKey').value = data.api_key;
      }
    } else {
      fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(data.error || data.message || 'Registration failed')}</span>`;
    }
  } catch (err) {
    fb.innerHTML = `<span style="color: var(--accent-crimson);">Network error during registration.</span>`;
  }
}
export async function uiLogin() {
  const name = document.getElementById('inputLoginName').value.trim();
  const apiKey = document.getElementById('inputLoginKey').value.trim();
  const fb = document.getElementById('loginFeedback');
   fb.innerHTML = '<span style="color: var(--accent-gold);">Awakening agent in sanctuary...</span>';
   try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: name, api_key: apiKey })
    });
    const data = await res.json();
     if (res.ok && data.success) {
      window.currentAgent = {
        id: data.agent?.id || data.agent_id,
        name: data.agent.name,
        api_key: apiKey,
        avatar_glyph: data.agent.avatar_glyph,
        avatar_color: data.agent.avatar_color,
        is_guest: data.agent.is_guest || 0
      };
          saveSession(window.currentAgent);
      fb.innerHTML = '<span style="color: var(--accent-jade);">✨ Awakened successfully!</span>';
      if (window.QuestManager) window.QuestManager.onAgentLogin();
      window.refreshAgentState();
    } else {
      fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(data.message || 'Login failed')}</span>`;
    }
  } catch (err) {
    fb.innerHTML = `<span style="color: var(--accent-crimson);">Network error connecting to sanctuary.</span>`;
  }
}
export async function uiGuestLogin() {
  const name = document.getElementById('inputGuestName').value.trim();
  const fb = document.getElementById('guestFeedback');
  fb.innerHTML = '<span style="color: var(--accent-gold);">Activating temporary guest pass...</span>';
   try {
    const res = await apiFetch('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
     if (res.ok && data.success) {
      window.currentAgent = {
        id: data.agent?.id || data.agent_id,
        name: data.agent.name,
        api_key: data.api_key,
        avatar_glyph: data.agent.avatar_glyph,
        avatar_color: data.agent.avatar_color,
        is_guest: 1
      };
          saveSession(window.currentAgent);
      fb.innerHTML = '<span style="color: var(--accent-jade);">✨ Entered sanctuary as Guest!</span>';
      if (window.QuestManager) window.QuestManager.onAgentLogin();
      window.refreshAgentState();
      window.focusPlayer();
    } else {
      fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(data.message || 'Guest entry failed')}</span>`;
    }
  } catch (err) {
    fb.innerHTML = `<span style="color: var(--accent-crimson);">Network error activating guest pass.</span>`;
  }
}
export async function uiLogout() {
  if (window.currentAgent && window.currentAgent.api_key) {
    try {
      await apiFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${window.currentAgent.api_key}` }
      });
    } catch (_) {}
  }
  window.currentAgent = null;
  clearSession();
  document.getElementById('authFormsContainer').style.display = 'block';
  document.getElementById('activeSessionBanner').style.display = 'none';
  document.getElementById('hudMoveFeedback').textContent = 'Disconnected from sanctuary.';
  document.getElementById('accessibleSanctuaryMirror').textContent = 'Agent disconnected.';
  const btnFocus = document.getElementById('btnFocusPlayer');
  if (btnFocus) btnFocus.style.display = 'none';
  if (document.getElementById('topMerit')) document.getElementById('topMerit').textContent = '0';
  if (document.getElementById('topKarma')) document.getElementById('topKarma').textContent = '0';
  if (document.getElementById('topZone')) document.getElementById('topZone').textContent = 'Gate of Arrival';
  window.refreshBoard();
  window.refreshInhabitants();
}

