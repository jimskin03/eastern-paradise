// Eastern Paradise — retro 16-bit sound system (Web Audio API synthesizer).
// Extracted verbatim from spectator.js (PR #2). Independently callable.

class SoundSystem {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('ep_sound_muted') === 'true';
    } catch (_) {}
  }

  init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.init();
    this.muted = !this.muted;
    try {
      localStorage.setItem('ep_sound_muted', String(this.muted));
    } catch (_) {}
    this.updateUI();
    if (!this.muted) {
      this.play('coin');
    }
    return this.muted;
  }

  updateUI() {
    const btn = document.getElementById('btnToggleMute');
    if (btn) {
      const icon = this.muted ? '🔇' : '🔊';
      const label = this.muted ? 'Sound Off' : 'Sound On';
      btn.innerHTML = `${icon} <span class="btn-text-full">${label}</span>`;
      btn.className = this.muted ? 'btn-sound muted' : 'btn-sound';
    }
  }

  play(soundName) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      switch (soundName) {
        case 'coin': {
          // Two-tone retro gold coin ding
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(987.77, now); // B5
          osc.frequency.setValueAtTime(1318.51, now + 0.07); // E6

          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

          osc.connect(gain);
          gain.connect(this.ctx.destination);

          osc.start(now);
          osc.stop(now + 0.32);
          break;
        }

        case 'puzzle_solve': {
          // Harmonious zen pentatonic arpeggio C5 - E5 - G5 - C6
          const notes = [523.25, 659.25, 783.99, 1046.50];
          notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);

            gain.gain.setValueAtTime(0.16, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.45);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.45);
          });
          break;
        }

        case 'chime': {
          // Resonance singing bowl / wind chime overtone
          const baseFreq = 587.33; // D5
          [1, 2.01, 3.02].forEach((mult, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(baseFreq * mult, now);

            gain.gain.setValueAtTime(0.12 / (idx + 1), now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 1.2);
          });
          break;
        }

        case 'step': {
          // Subtle retro woodblock step
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(280, now);
          osc.frequency.exponentialRampToValueAtTime(140, now + 0.05);

          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

          osc.connect(gain);
          gain.connect(this.ctx.destination);

          osc.start(now);
          osc.stop(now + 0.05);
          break;
        }

        case 'shrine_blessing': {
          // Celestial sparkle cascade
          const notes = [587.33, 739.99, 880.00, 1174.66, 1479.98];
          notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.09);

            gain.gain.setValueAtTime(0.15, now + idx * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.6);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.09);
            osc.stop(now + idx * 0.09 + 0.6);
          });
          break;
        }
      }
    } catch (_) {}
  }
}

const soundSystem = new SoundSystem();
window.soundSystem = soundSystem;
soundSystem.updateUI();

export { soundSystem as default, soundSystem };
