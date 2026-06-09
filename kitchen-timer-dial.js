// kitchen-timer-dial.js  –  V2.5
// Home Assistant Custom Lovelace Card
// 300° arc gauge · drag-to-set · tap/hold center · threshold colors
// Pulsing + red glow under 10%, dramatic "FERTIG!" screen, configurable finished_timeout
// Robust finish detection (dual: set hass + tick)

class KitchenTimerDial extends HTMLElement {

  /* ───────── lifecycle ───────── */

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._dragging = false;
    this._currentMinutes = 0;
    this._tickInterval = null;
    this._boundMove = (e) => this._onPointerMove(e);
    this._boundUp   = (e) => this._onPointerUp(e);
    // center hold detection
    this._centerDownTime = 0;
    this._centerDownTimer = null;
    this._centerHeld = false;
    // finished state
    this._finished = false;
    this._finishedTime = 0;
    this._finishedInterval = null;
    this._prevTimerStatus = 'idle';
    // track whether we already triggered finish for this run
    this._finishTriggered = false;
  }

  /* ───────── config ───────── */

  setConfig(config) {
    if (!config.input_entity || !config.timer_entity || !config.start_service) {
      throw new Error('Please define input_entity, timer_entity and start_service');
    }

    const defaultThresholds = [
      { from: 75, color: '#3b82f6' },
      { from: 50, color: '#22c55e' },
      { from: 25, color: '#eab308' },
      { from: 10, color: '#f97316' },
      { from:  0, color: '#ef4444' },
    ];

    const userThresholds = config.thresholds
      ? config.thresholds.map(t => ({ from: Number(t.from), color: String(t.color) }))
      : null;

    this._config = {
      title:             config.title             ?? 'Küchentimer',
      min:               Number(config.min         ?? 0),
      max:               Number(config.max         ?? 120),
      step:              Number(config.step        ?? 1),
      idle_color:        config.idle_color         ?? '#3b82f6',
      track_color:       config.track_color        ?? 'rgba(180,180,180,0.35)',
      knob_color:        config.knob_color         ?? '#ffffff',
      input_entity:      config.input_entity,
      timer_entity:      config.timer_entity,
      start_service:     config.start_service,
      show_hint:         config.show_hint !== undefined ? !!config.show_hint : true,
      finished_timeout:  Number(config.finished_timeout ?? 60),
      thresholds:        userThresholds ?? defaultThresholds,
    };

    this._config.thresholds.sort((a, b) => b.from - a.from);
    this._render();
  }

  static getStubConfig() {
    return {
      type: 'custom:kitchen-timer-dial',
      title: 'Küchentimer',
      input_entity:  'input_number.inp_kuchetimer',
      timer_entity:  'timer.tmr_kuchentimer',
      start_service: 'script.scr_kuchentimer',
      min: 0, max: 120, step: 1,
      show_hint: true,
      finished_timeout: 60,
    };
  }

  getCardSize() { return 4; }

  /* ───────── hass property ───────── */

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const st = hass.states[this._config.input_entity];
    if (!this._dragging) {
      this._currentMinutes = this._clamp(this._numState(st));
    }
    if (!this.shadowRoot.querySelector('ha-card')) this._render();

    const timerState = hass.states[this._config.timer_entity]?.state ?? 'idle';

    // Method 1: detect transition active → idle via hass update
    if (this._prevTimerStatus === 'active' && timerState === 'idle' && !this._finished) {
      this._triggerFinished();
    }

    // Reset finish guard when timer starts fresh
    if (timerState === 'active' && this._prevTimerStatus !== 'active') {
      this._finishTriggered = false;
    }

    this._prevTimerStatus = timerState;

    if (timerState === 'active') { this._startTick(); }
    else { this._stopTick(); }

    if (this._finished) { this._startTick(); }

    this._update();
  }

  /* ───────── constants: 300° arc ───────── */

  static ARC_DEG   = 300;
  static START_DEG = 120;
  static CX = 120;
  static CY = 120;
  static R  = 88;

  /* ───────── helpers ───────── */

  _numState(s) { const n = Number(s?.state); return Number.isNaN(n) ? this._config.min : n; }

  _clamp(v) {
    const { min, max, step } = this._config;
    return Math.min(max, Math.max(min, Math.round(v / step) * step));
  }

  _deg2rad(d) { return d * Math.PI / 180; }

  _pointOnArc(fraction) {
    const deg = KitchenTimerDial.START_DEG + fraction * KitchenTimerDial.ARC_DEG;
    const rad = this._deg2rad(deg);
    return {
      x: KitchenTimerDial.CX + Math.cos(rad) * KitchenTimerDial.R,
      y: KitchenTimerDial.CY + Math.sin(rad) * KitchenTimerDial.R,
    };
  }

  _arcPath(fraction) {
    const start = this._pointOnArc(0);
    const end   = this._pointOnArc(fraction);
    const sweep  = fraction * KitchenTimerDial.ARC_DEG;
    const largeArc = sweep > 180 ? 1 : 0;
    const R = KitchenTimerDial.R;
    return `M ${start.x} ${start.y} A ${R} ${R} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  }

  _trackPath() {
    const start = this._pointOnArc(0);
    const end   = this._pointOnArc(0.9999);
    const R = KitchenTimerDial.R;
    return `M ${start.x} ${start.y} A ${R} ${R} 0 1 1 ${end.x} ${end.y}`;
  }

  _pointerToFraction(evt) {
    const svg  = this.shadowRoot.querySelector('svg');
    const rect = svg.getBoundingClientRect();
    const cx   = rect.left + rect.width / 2;
    const cy   = rect.top  + rect.height / 2;
    let deg = Math.atan2(evt.clientY - cy, evt.clientX - cx) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    let offset = deg - KitchenTimerDial.START_DEG;
    if (offset < 0) offset += 360;
    if (offset > KitchenTimerDial.ARC_DEG) {
      const distToStart = 360 - offset;
      const distToEnd   = offset - KitchenTimerDial.ARC_DEG;
      offset = distToStart < distToEnd ? 0 : KitchenTimerDial.ARC_DEG;
    }
    return offset / KitchenTimerDial.ARC_DEG;
  }

  _isNearRing(evt) {
    const svg  = this.shadowRoot.querySelector('svg');
    const rect = svg.getBoundingClientRect();
    const cx   = rect.left + rect.width / 2;
    const cy   = rect.top  + rect.height / 2;
    const dist = Math.sqrt((evt.clientX - cx) ** 2 + (evt.clientY - cy) ** 2);
    const rPx  = rect.width * (KitchenTimerDial.R / 240);
    const tol  = rect.width * (22 / 240);
    return Math.abs(dist - rPx) <= tol;
  }

  /* ───────── timer helpers ───────── */

  _timerObj()    { return this._hass?.states[this._config.timer_entity]; }
  _timerStatus() { return this._timerObj()?.state ?? 'idle'; }

  _totalSec() {
    const t = this._timerObj();
    if (!t?.attributes?.duration) return 0;
    return this._hhmmssToSec(t.attributes.duration);
  }

  _remainingSec() {
    const t = this._timerObj();
    if (!t) return 0;
    if (t.attributes?.finishes_at) {
      const finish = new Date(t.attributes.finishes_at).getTime();
      return Math.max(0, Math.round((finish - Date.now()) / 1000));
    }
    if (t.attributes?.remaining) {
      return this._hhmmssToSec(t.attributes.remaining);
    }
    return 0;
  }

  _hhmmssToSec(str) {
    if (!str) return 0;
    const parts = String(str).split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  _remainingPct() {
    const total = this._totalSec();
    if (total <= 0) return 0;
    return (this._remainingSec() / total) * 100;
  }

  _thresholdColor(pct) {
    for (const t of this._config.thresholds) {
      if (pct >= t.from) return t.color;
    }
    return this._config.thresholds[this._config.thresholds.length - 1]?.color ?? '#ef4444';
  }

  _formatCountdown(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  _formatMinutes(mins) {
    return `${Math.max(0, Math.round(Number(mins) || 0))}`;
  }

  /* ───────── tick ───────── */

  _startTick() {
    if (this._tickInterval) return;
    this._tickInterval = setInterval(() => this._update(), 1000);
  }

  _stopTick() {
    if (!this._tickInterval) return;
    clearInterval(this._tickInterval);
    this._tickInterval = null;
  }

  /* ───────── finished state ───────── */

  _triggerFinished() {
    if (this._finishTriggered) return; // prevent double-trigger
    this._finishTriggered = true;
    this._finished = true;
    this._finishedTime = Date.now();
    this._startFinishedTimeout();
  }

  _startFinishedTimeout() {
    if (this._finishedInterval) clearTimeout(this._finishedInterval);
    this._finishedInterval = null;

    // 0 = stay forever until user interaction
    if (this._config.finished_timeout === 0) return;

    this._finishedInterval = setTimeout(() => {
      this._finished = false;
      this._stopTick();
      this._update();
    }, this._config.finished_timeout * 1000);
  }

  _clearFinished() {
    this._finished = false;
    if (this._finishedInterval) {
      clearTimeout(this._finishedInterval);
      this._finishedInterval = null;
    }
    this._stopTick();
    this._update();
  }

  /* ───────── service calls ───────── */

  _setInputNumber(val) {
    if (!this._hass) return;
    this._hass.callService('input_number', 'set_value', {
      entity_id: this._config.input_entity,
      value: val,
    });
  }

  _startTimer() {
    if (!this._hass) return;
    const [domain, service] = this._config.start_service.split('.');
    this._hass.callService(domain, service, {});
  }

  _pauseTimer() {
    if (!this._hass) return;
    this._hass.callService('timer', 'pause', {
      entity_id: this._config.timer_entity,
    });
  }

  _continueTimer() {
    if (!this._hass) return;
    this._hass.callService('timer', 'start', {
      entity_id: this._config.timer_entity,
    });
  }

  _cancelTimer() {
    if (!this._hass) return;
    this._hass.callService('timer', 'cancel', {
      entity_id: this._config.timer_entity,
    });
  }

  /* ───────── center tap / hold logic ───────── */

  _onCenterDown(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    this._centerHeld = false;
    this._centerDownTime = Date.now();
    this._centerDownTimer = setTimeout(() => {
      this._centerHeld = true;
      if (this._finished) {
        this._clearFinished();
        return;
      }
      this._cancelTimer();
      const hit = this.shadowRoot.querySelector('.center-hit');
      if (hit) {
        hit.style.fill = 'rgba(255,255,255,0.08)';
        setTimeout(() => { hit.style.fill = 'transparent'; }, 200);
      }
    }, 600);
  }

  _onCenterUp(evt) {
    evt.stopPropagation();
    if (this._centerDownTimer) {
      clearTimeout(this._centerDownTimer);
      this._centerDownTimer = null;
    }
    if (this._centerHeld) {
      this._centerHeld = false;
      return;
    }
    if (this._finished) {
      this._clearFinished();
      return;
    }
    const status = this._timerStatus();
    if (status === 'active') {
      this._pauseTimer();
    } else if (status === 'paused') {
      this._continueTimer();
    } else {
      this._startTimer();
    }
  }

  _onCenterCancel() {
    if (this._centerDownTimer) {
      clearTimeout(this._centerDownTimer);
      this._centerDownTimer = null;
    }
    this._centerHeld = false;
  }

  /* ───────── pointer events (ring drag) ───────── */

  _onPointerDown(evt) {
    if (!this._isNearRing(evt)) return;
    if (this._finished) {
      this._clearFinished();
      return;
    }
    evt.preventDefault();
    this._dragging = true;
    try { evt.target.setPointerCapture?.(evt.pointerId); } catch (_) {}
    window.addEventListener('pointermove', this._boundMove, { passive: false });
    window.addEventListener('pointerup',   this._boundUp,   { passive: true });
    this._applyPointer(evt);
  }

  _onPointerMove(evt) {
    if (!this._dragging) return;
    evt.preventDefault();
    this._applyPointer(evt);
  }

  _onPointerUp() {
    if (!this._dragging) return;
    this._dragging = false;
    window.removeEventListener('pointermove', this._boundMove);
    window.removeEventListener('pointerup',   this._boundUp);
  }

  _applyPointer(evt) {
    const frac = this._pointerToFraction(evt);
    const val  = this._clamp(this._config.min + frac * (this._config.max - this._config.min));
    if (val !== this._currentMinutes) {
      this._currentMinutes = val;
      this._update();
      this._setInputNumber(val);
    }
  }

  /* ───────── render ───────── */

  _render() {
    const trackD = this._trackPath();
    const showHint = this._config.show_hint;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          position: relative;
          overflow: hidden;
          padding: 20px 16px 14px;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          transition: border 300ms ease, box-shadow 300ms ease;
          border: 2px solid transparent;
        }
        .wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        svg {
          width: min(85vw, 300px);
          height: min(85vw, 300px);
          overflow: visible;
        }
        .track {
          fill: none;
          stroke-width: 18;
          stroke-linecap: round;
        }
        .progress {
          fill: none;
          stroke-width: 18;
          stroke-linecap: round;
          transition: stroke 200ms ease;
        }
        .knob {
          filter: drop-shadow(0 1px 4px rgba(0,0,0,0.35));
          transition: cx 80ms linear, cy 80ms linear;
        }
        .center-hit {
          fill: transparent;
          cursor: pointer;
        }
        .center-glow {
          pointer-events: none;
        }
        .center-value {
          font-size: 38px;
          font-weight: 700;
          text-anchor: middle;
          fill: var(--primary-text-color, #333);
          pointer-events: none;
        }
        .center-unit {
          font-size: 16px;
          font-weight: 400;
          fill: var(--secondary-text-color, #888);
          pointer-events: none;
        }
        .center-sub {
          font-size: 12px;
          text-anchor: middle;
          fill: var(--secondary-text-color, #888);
          pointer-events: none;
        }
        .center-icon {
          font-size: 52px;
          text-anchor: middle;
          dominant-baseline: middle;
          pointer-events: none;
        }
        .finished-label {
          pointer-events: none;
        }
        .finished-sub {
          pointer-events: none;
        }
        .title {
          font-size: 0.95rem;
          font-weight: 500;
          color: var(--primary-text-color, #333);
          text-align: center;
          margin-top: 0;
        }
        .hint {
          color: var(--secondary-text-color, #888);
          font-size: 0.72rem;
          text-align: center;
          margin-top: 4px;
          opacity: 0.7;
          display: ${showHint ? 'block' : 'none'};
        }

        /* ── slow pulse: last 10% ── */
        @keyframes pulse-slow {
          0%   { opacity: 1; }
          50%  { opacity: 0.35; }
          100% { opacity: 1; }
        }
        .pulse-slow {
          animation: pulse-slow 1s ease-in-out infinite;
        }

        /* ── fast dramatic blink: finished ── */
        @keyframes blink-fast {
          0%   { opacity: 1; }
          50%  { opacity: 0.15; }
          100% { opacity: 1; }
        }
        .blink-fast {
          animation: blink-fast 0.6s ease-in-out infinite;
        }

        /* ── card border glow ── */
        @keyframes glow-pulse {
          0%   { box-shadow: 0 0 15px rgba(239,68,68,0.4); }
          50%  { box-shadow: 0 0 25px rgba(239,68,68,0.7); }
          100% { box-shadow: 0 0 15px rgba(239,68,68,0.4); }
        }
        .card-alert {
          border: 2px solid #ef4444 !important;
          animation: glow-pulse 1s ease-in-out infinite;
        }

        @keyframes glow-blink {
          0%   { box-shadow: 0 0 20px rgba(239,68,68,0.6); }
          50%  { box-shadow: 0 0 35px rgba(239,68,68,0.9); }
          100% { box-shadow: 0 0 20px rgba(239,68,68,0.6); }
        }
        .card-finished {
          border: 2px solid #ef4444 !important;
          animation: glow-blink 0.6s ease-in-out infinite;
        }

        /* hide helper */
        .hidden { display: none; }
      </style>

      <ha-card>
        <div class="wrap">
          <svg viewBox="0 0 240 260" aria-label="Kitchen Timer Dial">
            <path class="track" d="${trackD}" />
            <path class="progress" d="${trackD}" />
            <circle class="knob" cx="0" cy="0" r="11" />
            <!-- center glow circle (for finished state) -->
            <circle class="center-glow hidden" cx="120" cy="120" r="58"
                    fill="rgba(239,68,68,0.12)" />
            <circle class="center-hit" cx="120" cy="120" r="62" />
            <!-- normal view elements -->
            <text class="center-value" x="120" y="115"></text>
            <text class="center-unit"  x="170" y="115"></text>
            <text class="center-sub"   x="120" y="148"></text>
            <!-- finished view elements (hidden by default) -->
            <text class="center-icon hidden" x="120" y="100">\uD83D\uDD14</text>
            <text class="finished-label hidden" x="120" y="148"
                  font-size="32" font-weight="800" text-anchor="middle"
                  fill="#ef4444">FERTIG!</text>
            <text class="finished-sub hidden" x="120" y="172"
                  font-size="11" text-anchor="middle"
                  fill="#ef4444">Tippen = OK</text>
          </svg>
          <div class="title"></div>
          <div class="hint">Ring ziehen = einstellen · Tippen = Start/Pause · Halten = Reset</div>
        </div>
      </ha-card>
    `;

    // Ring drag
    const svg = this.shadowRoot.querySelector('svg');
    svg.addEventListener('pointerdown', (e) => this._onPointerDown(e));

    // Center tap / hold
    const hit = this.shadowRoot.querySelector('.center-hit');
    hit.addEventListener('pointerdown',   (e) => this._onCenterDown(e));
    hit.addEventListener('pointerup',     (e) => this._onCenterUp(e));
    hit.addEventListener('pointercancel', ()  => this._onCenterCancel());
    hit.addEventListener('pointerleave',  ()  => this._onCenterCancel());
    hit.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ───────── update ───────── */

  _update() {
    if (!this._config || !this._hass) return;

    const card          = this.shadowRoot.querySelector('ha-card');
    const progressEl    = this.shadowRoot.querySelector('.progress');
    const trackEl       = this.shadowRoot.querySelector('.track');
    const knobEl        = this.shadowRoot.querySelector('.knob');
    const valueEl       = this.shadowRoot.querySelector('.center-value');
    const unitEl        = this.shadowRoot.querySelector('.center-unit');
    const subEl         = this.shadowRoot.querySelector('.center-sub');
    const titleEl       = this.shadowRoot.querySelector('.title');
    const iconEl        = this.shadowRoot.querySelector('.center-icon');
    const finishedLabel = this.shadowRoot.querySelector('.finished-label');
    const finishedSub   = this.shadowRoot.querySelector('.finished-sub');
    const glowCircle    = this.shadowRoot.querySelector('.center-glow');

    const status   = this._timerStatus();
    const isActive = status === 'active';
    const isPaused = status === 'paused';
    const range    = this._config.max - this._config.min;

    // Method 2: detect finish via tick (remaining hit 0 while still "active")
    if (isActive && this._remainingSec() <= 0 && !this._finished && !this._finishTriggered) {
      this._triggerFinished();
    }

    // ── FINISHED STATE ──
    if (this._finished) {
      valueEl.classList.add('hidden');
      unitEl.classList.add('hidden');
      subEl.classList.add('hidden');
      iconEl.classList.remove('hidden');
      finishedLabel.classList.remove('hidden');
      finishedSub.classList.remove('hidden');
      glowCircle.classList.remove('hidden');
      glowCircle.classList.add('blink-fast');
      iconEl.classList.add('blink-fast');
      finishedLabel.classList.add('blink-fast');
      finishedSub.classList.add('blink-fast');
      progressEl.classList.add('blink-fast');
      progressEl.classList.remove('pulse-slow');
      progressEl.setAttribute('d', this._arcPath(0.9999));
      progressEl.style.stroke = '#ef4444';
      trackEl.style.stroke = 'rgba(239, 68, 68, 0.2)';
      const knobPt = this._pointOnArc(0.9999);
      knobEl.setAttribute('cx', knobPt.x);
      knobEl.setAttribute('cy', knobPt.y);
      knobEl.style.fill = '#ef4444';
      knobEl.classList.add('blink-fast');
      // card glow
      card.classList.remove('card-alert');
      card.classList.add('card-finished');
      titleEl.textContent = this._config.title;
      return;
    }

    // ── NORMAL STATES ──
    valueEl.classList.remove('hidden');
    unitEl.classList.remove('hidden');
    subEl.classList.remove('hidden');
    iconEl.classList.add('hidden');
    finishedLabel.classList.add('hidden');
    finishedSub.classList.add('hidden');
    glowCircle.classList.add('hidden');
    glowCircle.classList.remove('blink-fast');
    iconEl.classList.remove('blink-fast');
    finishedLabel.classList.remove('blink-fast');
    finishedSub.classList.remove('blink-fast');
    knobEl.classList.remove('blink-fast');
    card.classList.remove('card-finished');

    let fraction, color;

    if (isActive) {
      const pct = this._remainingPct();
      fraction  = Math.max(0, Math.min(1, pct / 100));
      color     = this._thresholdColor(pct);

      const sec = this._remainingSec();
      valueEl.textContent = this._formatCountdown(sec);
      unitEl.textContent  = '';
      subEl.textContent   = 'Tippen = Pause';

      if (pct < 10) {
        progressEl.classList.add('pulse-slow');
        valueEl.classList.add('pulse-slow');
        knobEl.classList.add('pulse-slow');
        subEl.classList.add('pulse-slow');
        card.classList.add('card-alert');
      } else {
        progressEl.classList.remove('pulse-slow');
        valueEl.classList.remove('pulse-slow');
        knobEl.classList.remove('pulse-slow');
        subEl.classList.remove('pulse-slow');
        card.classList.remove('card-alert');
      }

    } else if (isPaused) {
      const pct = this._remainingPct();
      fraction  = Math.max(0, Math.min(1, pct / 100));
      color     = this._thresholdColor(pct);

      const sec = this._remainingSec();
      valueEl.textContent = this._formatCountdown(sec);
      unitEl.textContent  = '';
      subEl.textContent   = 'Tippen = Weiter';
      progressEl.classList.remove('pulse-slow');
      valueEl.classList.remove('pulse-slow');
      knobEl.classList.remove('pulse-slow');
      subEl.classList.remove('pulse-slow');
      card.classList.remove('card-alert');

    } else {
      fraction = range <= 0 ? 0 : (this._currentMinutes - this._config.min) / range;
      fraction = Math.max(0, Math.min(1, fraction));
      color    = this._config.idle_color;

      valueEl.textContent = this._formatMinutes(this._currentMinutes);
      unitEl.textContent  = 'min';
      subEl.textContent   = 'Tippen = Start';
      progressEl.classList.remove('pulse-slow');
      valueEl.classList.remove('pulse-slow');
      knobEl.classList.remove('pulse-slow');
      subEl.classList.remove('pulse-slow');
      card.classList.remove('card-alert');
    }

    trackEl.style.stroke = this._config.track_color;

    if (fraction <= 0.001) {
      progressEl.setAttribute('d', '');
    } else {
      progressEl.setAttribute('d', this._arcPath(Math.min(fraction, 0.9999)));
    }
    progressEl.style.stroke = color;
    progressEl.classList.remove('blink-fast');

    const knobPt = this._pointOnArc(Math.max(0, Math.min(fraction, 0.9999)));
    knobEl.setAttribute('cx', knobPt.x);
    knobEl.setAttribute('cy', knobPt.y);
    knobEl.style.fill = (isActive || isPaused) ? color : this._config.knob_color;

    titleEl.textContent = this._config.title;

    const bbox = valueEl.getBBox?.();
    if (bbox) {
      unitEl.setAttribute('x', bbox.x + bbox.width + 4);
      unitEl.setAttribute('y', '115');
    }
  }
}

/* ───────── register ───────── */
customElements.define('kitchen-timer-dial', KitchenTimerDial);
window.customCards = window.customCards || [];
window.customCards.push({
  type:        'kitchen-timer-dial',
  name:        'Kitchen Timer Dial',
  description: 'Circular 300° kitchen timer dial – drag to set, tap to start/pause, hold to reset, threshold colors, dramatic finish with glow.',
});
