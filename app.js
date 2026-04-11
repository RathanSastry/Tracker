/* ══════════════════════════════════════════════════════════
   DRS V2 — Modular Architecture
   ══════════════════════════════════════════════════════════
   Modules: Auth · Storage · State · Toast · Nav · Onboarding
            Map · Tracker · Performance · Achievements
            Social · Insights · Audio · Intervals
            Share · Home · Profile · App
   ══════════════════════════════════════════════════════════ */
'use strict';

/* ════════════════════════════════════════
   SUPABASE CONFIG
   Replace the two values below with your
   project URL and anon key from:
   supabase.com → Settings → API
════════════════════════════════════════ */
const SUPABASE_URL      = 'https://yjirzzsnxpgxafqxoapx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yr_BNASMqN_XZg1qkIHg1Q_Tm705ih6';
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ════════════════════════════════════════
   AUTH MODULE
════════════════════════════════════════ */
const Auth = {
  user: null,
  _isSignUp: false,

  async init() {
    _supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        localStorage.clear();
        location.reload();
      } else if (event === 'TOKEN_REFRESHED' && session) {
        Auth.user = session.user;
      }
    });

    const { data: { session } } = await _supabase.auth.getSession();
    if (session?.user) {
      this.user = session.user;
      return session.user;
    }
    // No auth required on load — guest access allowed for first activity
    return null;
  },

  _showModal(message) {
    const subtitle = document.getElementById('auth-subtitle');
    if (message && subtitle) subtitle.textContent = message;
    document.getElementById('auth-overlay').classList.remove('hidden');
    const submit = document.getElementById('auth-submit');
    const toggle = document.getElementById('auth-toggle');
    if (!submit._bound) {
      submit._bound = true;
      submit.addEventListener('click', () => Auth.handleSubmit());
      document.getElementById('auth-toggle').addEventListener('click', () => Auth.toggleMode());
      document.getElementById('auth-password').addEventListener('keydown', e => {
        if (e.key === 'Enter') Auth.handleSubmit();
      });
    }
  },

  toggleMode() {
    this._isSignUp = !this._isSignUp;
    document.getElementById('auth-subtitle').textContent  = this._isSignUp ? 'Create your account' : 'Sign in to your account';
    document.getElementById('auth-submit').textContent    = this._isSignUp ? 'Create Account' : 'Sign In';
    document.getElementById('auth-toggle-label').textContent = this._isSignUp ? 'Already have one? Sign in' : 'Create one';
  },

  async handleSubmit() {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const btn      = document.getElementById('auth-submit');
    if (!email || !password) { Toast.warning('Enter your email and password'); return; }
    btn.disabled = true;
    btn.textContent = '…';
    try {
      if (this._isSignUp) {
        const { error } = await _supabase.auth.signUp({ email, password });
        if (error) throw error;
        Toast.info('Check your email to confirm, then sign in.');
        this.toggleMode();
      } else {
        const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        this.user = data.user;
        document.getElementById('auth-overlay').classList.add('hidden');
        await SupaStorage.loadAll();
        if (App._initialized) {
          // App already running as guest — just refresh views with cloud data
          Home.refresh();
          Profile.refresh();
          StripeEngine.updateUI();
        } else {
          App.initApp();
        }
      }
    } catch (e) {
      Toast.error(e.message || 'Authentication failed');
    } finally {
      btn.disabled = false;
      btn.textContent = this._isSignUp ? 'Create Account' : 'Sign In';
    }
  },

  async signOut() {
    await _supabase.auth.signOut();
    localStorage.clear();
    location.reload();
  },
};

/* ════════════════════════════════════════
   SUPABASE STORAGE
   Write-through cache: localStorage + Supabase
════════════════════════════════════════ */
const SupaStorage = {

  async loadAll() {
    const uid = Auth.user?.id;
    if (!uid) return;
    const [profileRes, settingsRes, workoutsRes, badgesRes, subRes] = await Promise.allSettled([
      _supabase.from('profiles').select('*').eq('id', uid).single(),
      _supabase.from('settings').select('*').eq('user_id', uid).single(),
      _supabase.from('workouts').select('*').eq('user_id', uid).order('date', { ascending: false }),
      _supabase.from('badges').select('*').eq('user_id', uid),
      _supabase.from('subscriptions').select('status').eq('user_id', uid).single(),
    ]);

    const pv = profileRes.value?.data;
    if (pv) Storage.setProfile({ name: pv.name, avatar: pv.avatar, joinedAt: new Date(pv.joined_at).getTime() });

    const sv = settingsRes.value?.data;
    if (sv) Storage.setSettings({ weightKg: sv.weight_kg, age: sv.age, gender: sv.gender, restingHR: sv.resting_hr, audioOn: sv.audio_on, hydrationReminders: sv.hydration_reminders, safetyAlerts: sv.safety_alerts });

    const wv = workoutsRes.value?.data;
    if (wv) Storage.setHistory(wv.map(w => ({ id: w.id, date: w.date, mode: w.mode, distanceKm: w.distance_km, durationMs: w.duration_ms, avgPaceSecPerKm: w.avg_pace_sec_per_km, calories: w.calories, steps: w.steps, avgHR: w.avg_hr, maxSpeedKmh: w.max_speed_kmh, avgSpeedKmh: w.avg_speed_kmh, zoneSeconds: w.zone_seconds, coords: w.coords })));

    const bv = badgesRes.value?.data;
    if (bv) {
      const badges = {};
      bv.forEach(b => { badges[b.badge_id] = { date: new Date(b.earned_at).getTime() }; });
      Storage.setBadges(badges);
    }

    Storage._set('rt_pro', subRes.value?.data?.status === 'active');
  },

  async saveProfile(profile) {
    Storage.setProfile(profile);
    const uid = Auth.user?.id;
    if (!uid) return;
    await _supabase.from('profiles').upsert({ id: uid, name: profile.name, avatar: profile.avatar, joined_at: new Date(profile.joinedAt || Date.now()).toISOString() });
  },

  async saveSettings(settings) {
    Storage.setSettings(settings);
    const uid = Auth.user?.id;
    if (!uid) return;
    await _supabase.from('settings').upsert({ user_id: uid, weight_kg: settings.weightKg, age: settings.age, gender: settings.gender || 'male', resting_hr: settings.restingHR, audio_on: settings.audioOn !== false, hydration_reminders: settings.hydrationReminders !== false, safety_alerts: settings.safetyAlerts !== false });
  },

  async addWorkout(session) {
    Storage.addHistory(session);
    const uid = Auth.user?.id;
    if (!uid) return;
    const { data } = await _supabase.from('workouts').insert({
      user_id: uid,
      date: new Date(session.date || Date.now()).toISOString(),
      mode: session.mode, distance_km: session.distanceKm, duration_ms: session.durationMs,
      avg_pace_sec_per_km: session.avgPaceSecPerKm, calories: session.calories, steps: session.steps,
      avg_hr: session.avgHR, max_speed_kmh: session.maxSpeedKmh, avg_speed_kmh: session.avgSpeedKmh,
      zone_seconds: session.zoneSeconds || {}, coords: session.coords || [],
    }).select().single();
    if (data) {
      await _supabase.from('feed_posts').insert({
        user_id: uid, workout_id: data.id,
        text: `Just completed a ${MODES[session.mode]?.name || session.mode}! ${session.distanceKm.toFixed(2)}km in ${Tracker.formatTime(session.durationMs)}.`,
      });
    }
  },

  async saveBadges(badges) {
    Storage.setBadges(badges);
    const uid = Auth.user?.id;
    if (!uid) return;
    const rows = Object.entries(badges).map(([badge_id, info]) => ({ user_id: uid, badge_id, earned_at: new Date(info.date).toISOString() }));
    if (rows.length) await _supabase.from('badges').upsert(rows, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
  },
};

/* ════════════════════════════════════════
   STORAGE ENGINE
════════════════════════════════════════ */
const Storage = {
  _get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  _set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      // Quota exceeded — prune oldest history entries
      const hist = this._get('rt_history', []);
      if (hist.length > 5) {
        this._set('rt_history', hist.slice(-5));
        try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
      }
    }
  },
  getProfile()    { return this._get('rt_profile', { name: '', avatar: '🏃', joinedAt: Date.now() }); },
  setProfile(v)   { this._set('rt_profile', v); },
  getSettings()   { return this._get('rt_settings', { weightKg: 70, age: 25, gender: 'male', restingHR: 60, audioOn: true, hydrationReminders: true, safetyAlerts: true }); },
  setSettings(v)  { this._set('rt_settings', v); },
  getHistory()    { return this._get('rt_history', []); },
  setHistory(v)   { this._set('rt_history', v); },
  addHistory(s)   { const h = this.getHistory(); h.push(s); this.setHistory(h); },
  getBadges()     { return this._get('rt_badges', {}); },
  setBadges(v)    { this._set('rt_badges', v); },
  getFeed()       { return this._get('rt_feed', []); },
  setFeed(v)      { this._set('rt_feed', v); },
  getFriends()    { return this._get('rt_friends', { list: [], sent: [], received: [], suggestions: [] }); },
  setFriends(v)   { this._set('rt_friends', v); },
  getChallenges() { return this._get('rt_challenges', []); },
  setChallenges(v){ this._set('rt_challenges', v); },
  getGoal()       { return this._get('rt_goal', null); },
  setGoal(v)      { this._set('rt_goal', v); },
  getInsights()   { return this._get('rt_insights', { generated: 0, data: [] }); },
  setInsights(v)  { this._set('rt_insights', v); },
  isSeeded()      { return this._get('rt_seeded', false); },
  markSeeded()    { this._set('rt_seeded', true); },
};

/* ════════════════════════════════════════
   ACTIVITY MODES CONFIG
════════════════════════════════════════ */
const MODES = {
  running:   { icon:'🏃', name:'Running',    color:'#FF6500', routeColor:'#FF6500', stepFactor:1.80, calMult:1.00, maxSpeedRef:20, intensityRef:14 },
  jogging:   { icon:'🏃', name:'Jogging',    color:'#FF8534', routeColor:'#FF8A45', stepFactor:1.50, calMult:0.80, maxSpeedRef:10, intensityRef:9  },
  walking:   { icon:'🚶', name:'Walking',    color:'#00D97E', routeColor:'#00D97E', stepFactor:1.10, calMult:0.50, maxSpeedRef:7,  intensityRef:5  },
  hiking:    { icon:'🥾', name:'Hiking',     color:'#FFB340', routeColor:'#FFB340', stepFactor:1.20, calMult:0.70, maxSpeedRef:6,  intensityRef:5  },
  cycling:   { icon:'🚴', name:'Cycling',    color:'#4FC3F7', routeColor:'#4FC3F7', stepFactor:0.00, calMult:0.60, maxSpeedRef:35, intensityRef:22 },
};

/* ════════════════════════════════════════
   STATE
════════════════════════════════════════ */
const State = {
  status: 'idle',         // idle | running | paused
  mode:   'running',      // running | jogging | walking | hiking | cycling
  startTime: 0,
  pausedMs: 0,
  pauseStart: 0,
  distanceKm: 0,
  coords: [],
  lastCoord: null,
  currentSpeedKmh: 0,
  avgSpeedKmh: 0,
  maxSpeedKmh: 0,
  steps: 0,
  hr: 0,
  hrZone: 'rest',
  calories: 0,
  // Advanced
  strideM: 0,
  powerW: 0,
  tempC: 36.5,
  sweatMl: 0,
  o2Pct: 98,
  fatiguePct: 0,
  // Session tracking
  speedBuffer: [],
  hrBuffer: [],
  zoneSeconds: { rest:0, fat:0, cardio:0, vigorous:0, max:0 },
  // Timers
  timerInterval: null,
  trackInterval: null,
  ecgInterval: null,
  safetyTimer: null,
  hydrationTimer: null,
  lastMoveTime: 0,
  lastHydrationTime: 0,
  // GPS
  gpsWatchId: null,
  gpsAccuracy: null,
  // Interval training
  intervalActive: false,
  intervalConfig: null,
  intervalPhase: 'work',
  intervalRep: 0,
  intervalPhaseStart: 0,
  intervalTimer: null,
  // Goal
  goal: null,
};

/* ════════════════════════════════════════
   TOAST ENGINE
════════════════════════════════════════ */
const Toast = {
  show(msg, type = 'info', duration = 3000) {
    const stack = document.getElementById('toast-stack');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg)    { this.show(msg, 'info'); },
};

/* ════════════════════════════════════════
   NAVIGATION ENGINE
════════════════════════════════════════ */
const Nav = {
  current: 'home',
  views: ['home', 'social', 'track', 'profile'],

  init() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => this.go(btn.dataset.nav));
    });
  },

  go(view) {
    if (this.current === view) return;
    const prev = document.getElementById(`v-${this.current}`);
    const next = document.getElementById(`v-${view}`);
    if (!next) return;

    if (prev) { prev.classList.remove('active'); prev.classList.add('hidden'); }
    next.classList.remove('hidden'); next.classList.add('active');

    document.querySelectorAll('[data-nav]').forEach(b => {
      b.classList.toggle('active', b.dataset.nav === view);
    });

    this.current = view;

    // View-specific setup
    if (view === 'track') MapEngine.onViewShown();
    if (view === 'home')  Home.refresh();
    if (view === 'profile') Profile.refresh();
    if (view === 'social')  Social.refresh();
  },
};

/* ════════════════════════════════════════
   MODAL ENGINE
════════════════════════════════════════ */
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('hidden'); }
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); }
  },
  init() {
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => this.close(btn.dataset.close));
    });
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.close(backdrop.id);
      });
    });
  },
};

/* ════════════════════════════════════════
   ONBOARDING ENGINE
════════════════════════════════════════ */
const Onboarding = {
  step: 1,
  selectedAvatar: '🏃',

  init() {
    const profile = Storage.getProfile();
    if (!profile.name) {
      document.getElementById('onboarding').classList.remove('hidden');
      this.bindEvents();
    }
  },

  bindEvents() {
    document.querySelectorAll('.av-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.av-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedAvatar = btn.dataset.av;
      });
    });
    document.getElementById('ob-next').addEventListener('click', () => this.nextStep());
  },

  nextStep() {
    if (this.step === 1) {
      const name = document.getElementById('ob-name').value.trim();
      if (!name) { Toast.warning('Please enter your name'); return; }
      this.step = 2;
      document.getElementById('ob-step-1').classList.add('hidden');
      document.getElementById('ob-step-2').classList.remove('hidden');
      document.getElementById('ob-next').textContent = 'Get Started';
      document.getElementById('dot-1').classList.remove('active');
      document.getElementById('dot-2').classList.add('active');
    } else {
      const name = document.getElementById('ob-name').value.trim();
      const weight = parseInt(document.getElementById('ob-weight').value) || 70;
      const age    = parseInt(document.getElementById('ob-age').value) || 25;
      const gender = document.getElementById('ob-gender').value;

      SupaStorage.saveProfile({ name, avatar: this.selectedAvatar, joinedAt: Date.now() });
      SupaStorage.saveSettings({ ...Storage.getSettings(), weightKg: weight, age, gender });
      document.getElementById('onboarding').classList.add('hidden');
      Home.refresh();
    }
  },
};

/* ════════════════════════════════════════
   MAP ENGINE
════════════════════════════════════════ */
const MapEngine = {
  map: null,
  marker: null,
  polyline: null,
  accuracyCircle: null,
  initialized: false,
  _pendingInvalidate: false,

  initIfNeeded() {
    if (this.initialized) return;
    if (typeof L === 'undefined') { setTimeout(() => this.initIfNeeded(), 300); return; }

    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    this.map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      tap: false,
      dragging: true,
      scrollWheelZoom: true,
    }).setView([20, 0], 2);

    // Dark CartoDB tiles — no CSS filter needed
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '© CartoDB',
    }).addTo(this.map);

    // Zoom control — top right
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Attribution — small, bottom right
    L.control.attribution({ position: 'bottomright', prefix: '' }).addTo(this.map);

    // Route polyline
    this.polyline = L.polyline([], {
      color: '#FF6500',
      weight: 5,
      opacity: 0.92,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(this.map);

    this.initialized = true;

    // Invalidate after render cycle so Leaflet gets correct dimensions
    requestAnimationFrame(() => {
      this.map.invalidateSize({ animate: false });
      this.locateOnce();
    });
  },

  // Called when track view becomes visible — ensures correct render size
  onViewShown() {
    if (!this.initialized) {
      this.initIfNeeded();
      return;
    }
    requestAnimationFrame(() => {
      this.map.invalidateSize({ animate: false });
    });
  },

  locateOnce() {
    if (!navigator.geolocation) { Tracker.setGPSStatus('unavailable'); return; }
    Tracker.setGPSStatus('acquiring');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        this.map.setView([lat, lng], 15, { animate: false });
        this.updateMarker(lat, lng, pos.coords.accuracy);
        Tracker.setGPSStatus('locked');
      },
      () => { Tracker.setGPSStatus('error'); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  },

  updateMarker(lat, lng, accuracy) {
    if (!this.map) return;

    // Accuracy circle
    if (accuracy && accuracy < 200) {
      if (this.accuracyCircle) this.map.removeLayer(this.accuracyCircle);
      this.accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: 'transparent',
        fillColor: '#FF6500',
        fillOpacity: 0.08,
        weight: 0,
      }).addTo(this.map);
    }

    // Position dot
    if (this.marker) this.map.removeLayer(this.marker);
    const modeColor = MODES[State.mode]?.color || '#FF6500';
    const icon = L.divIcon({
      className: '',
      html: `
        <div style="
          position:relative; width:22px; height:22px;
          display:flex; align-items:center; justify-content:center;">
          <div style="
            position:absolute; width:22px; height:22px; border-radius:50%;
            background:${modeColor}22; border:1px solid ${modeColor}55;
            animation:pulse-ring 2s ease-in-out infinite;"></div>
          <div style="
            width:14px; height:14px; border-radius:50%;
            background:${modeColor}; border:2.5px solid white;
            box-shadow:0 2px 8px ${modeColor}80;
            position:relative; z-index:2;"></div>
        </div>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
    this.marker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(this.map);
  },

  addPoint(lat, lng, accuracy) {
    if (!this.polyline || !this.map) return;
    // Update route color to match current mode
    const modeColor = MODES[State.mode]?.routeColor || '#FF6500';
    this.polyline.setStyle({ color: modeColor });
    this.polyline.addLatLng([lat, lng]);
    this.updateMarker(lat, lng, accuracy);
    // Only pan if close to edge or first points
    const bounds = this.map.getBounds();
    const latlng = L.latLng(lat, lng);
    if (!bounds.contains(latlng) || this.polyline.getLatLngs().length <= 3) {
      this.map.setView(latlng, Math.max(16, this.map.getZoom()), { animate: true, duration: 0.5 });
    }
  },

  reset() {
    if (this.polyline) this.polyline.setLatLngs([]);
    if (this.accuracyCircle) { this.map.removeLayer(this.accuracyCircle); this.accuracyCircle = null; }
  },

  // Fit map to show whole route
  fitRoute() {
    if (!this.polyline || !this.map) return;
    const lls = this.polyline.getLatLngs();
    if (lls.length > 1) {
      this.map.fitBounds(L.latLngBounds(lls), { padding: [40, 40], animate: true });
    }
  },
};

/* ════════════════════════════════════════
   PERFORMANCE ENGINE (metrics)
════════════════════════════════════════ */
const Perf = {
  ecgPhase: 0,
  ecgCanvas: null,
  ecgCtx: null,
  ecgData: [],

  init() {
    this.ecgCanvas = document.getElementById('ecg-canvas');
    if (this.ecgCanvas) {
      this.ecgCtx = this.ecgCanvas.getContext('2d');
      this.ecgData = new Array(100).fill(0);
    }
  },

  updateHR() {
    const s    = Storage.getSettings();
    const mode = MODES[State.mode] || MODES.running;
    const maxHR = 220 - (s.age || 25);
    // Use mode-specific speed reference so HR reflects correct effort per mode
    const intensity = Math.min(1, State.currentSpeedKmh / mode.intensityRef) * mode.calMult;
    const targetHR  = s.restingHR + intensity * (maxHR - s.restingHR) * 0.88;

    // Smooth with EMA
    State.hr = Math.round(State.hr === 0 ? targetHR : State.hr * 0.92 + targetHR * 0.08);
    State.hr = Math.max(s.restingHR, Math.min(maxHR, State.hr));

    // Zone classification
    const pct = (State.hr - s.restingHR) / (maxHR - s.restingHR);
    if      (pct < 0.5)  State.hrZone = 'rest';
    else if (pct < 0.65) State.hrZone = 'fat';
    else if (pct < 0.8)  State.hrZone = 'cardio';
    else if (pct < 0.9)  State.hrZone = 'vigorous';
    else                 State.hrZone = 'max';

    // Zone second tracking
    if (State.status === 'running') {
      State.zoneSeconds[State.hrZone] = (State.zoneSeconds[State.hrZone] || 0) + 1;
    }

    this.updateECG();
    this.updateZoneBar();
  },

  updateECG() {
    if (!this.ecgCtx) return;
    const w = this.ecgCanvas.offsetWidth || 200;
    const h = this.ecgCanvas.offsetHeight || 56;
    this.ecgCanvas.width  = w;
    this.ecgCanvas.height = h;

    this.ecgPhase += 0.15 + (State.hr / 300);
    const t = this.ecgPhase;
    // Simulate ECG waveform
    let v = 0;
    const cycle = t % (Math.PI * 2);
    if (cycle < 0.3)       v = 0;
    else if (cycle < 0.5)  v = -8 * (cycle - 0.3);
    else if (cycle < 0.7)  v = 60 * (cycle - 0.5);
    else if (cycle < 0.85) v = -40 * (cycle - 0.7) + 12;
    else if (cycle < 1.1)  v = 30 * Math.sin((cycle - 0.85) * Math.PI / 0.25);
    else                   v = 0;
    v = v / 100;

    this.ecgData.push(v);
    if (this.ecgData.length > w) this.ecgData.shift();

    const ctx = this.ecgCtx;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#FF4757';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = w / Math.max(this.ecgData.length, 1);
    this.ecgData.forEach((d, i) => {
      const x = i * step;
      const y = h / 2 - d * h * 0.4;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  },

  updateBodyMetrics() {
    const elapsed = Tracker.getElapsedMs() / 1000;
    const s    = Storage.getSettings();
    const mode = MODES[State.mode] || MODES.running;
    // Step count — zero for non-step modes (cycling, swimming)
    const stepRate = mode.stepFactor * (1 + State.currentSpeedKmh * 0.04);
    State.steps   = Math.floor(elapsed * stepRate);
    State.strideM = State.steps > 0 && State.distanceKm > 0
      ? parseFloat((State.distanceKm * 1000 / State.steps).toFixed(2)) : 0;
    // Power varies by mode and speed
    State.powerW  = Math.round(s.weightKg * State.currentSpeedKmh * 0.30 * mode.calMult * (1 + State.fatiguePct / 200));
    State.sweatMl = Math.round(elapsed / 60 * s.weightKg * 0.014 * mode.calMult * (1 + State.currentSpeedKmh / 35));
    State.tempC   = parseFloat((36.5 + Math.min(2.5, elapsed / 1500 * mode.calMult)).toFixed(1));
    State.o2Pct   = Math.max(90, Math.round(98 - State.fatiguePct * 0.06));
    State.fatiguePct = Math.min(100, parseFloat((elapsed / 3600 * 28 * mode.calMult).toFixed(1)));
  },

  updateCalories() {
    const s    = Storage.getSettings();
    const mode = MODES[State.mode] || MODES.running;
    const elapsed  = Tracker.getElapsedMs() / 1000 / 60;
    const maxHR    = 220 - (s.age || 25);
    const hrFrac   = (State.hr - s.restingHR) / (maxHR - s.restingHR + 0.001);
    // Apply mode calorie multiplier so HIIT burns more than walking
    State.calories = Math.round(s.weightKg * Math.max(0.01, hrFrac) * 0.048 * elapsed * mode.calMult);
  },

  updateZoneBar() {
    document.querySelectorAll('.hz').forEach(el => {
      el.classList.toggle('active', el.dataset.z === State.hrZone);
    });
  },

  getZoneLabel() {
    const labels = { rest: 'Rest', fat: 'Fat Burn', cardio: 'Cardio', vigorous: 'Vigorous', max: 'Max' };
    return labels[State.hrZone] || '—';
  },
};

/* ════════════════════════════════════════
   TRACKER ENGINE
════════════════════════════════════════ */
const Tracker = {
  getElapsedMs() {
    if (State.status === 'idle') return 0;
    const raw = Date.now() - State.startTime - State.pausedMs;
    return Math.max(0, raw);
  },

  formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  },

  formatPace(secPerKm) {
    if (!secPerKm || !isFinite(secPerKm) || secPerKm > 3600) return '--:--';
    const m = Math.floor(secPerKm / 60);
    const s = Math.floor(secPerKm % 60);
    return `${m}:${String(s).padStart(2,'0')}`;
  },

  haversine(lat1, lng1, lat2, lng2) {
    const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  start() {
    if (State.status === 'running') return;

    // Guest gate: allow first activity freely, enforce sign-up from second onward
    if (!Auth.user && Storage.getHistory().length >= 1) {
      Auth._showModal('Create a free account to keep recording your activities!');
      return;
    }

    if (State.status === 'idle') {
      State.startTime = Date.now();
      State.pausedMs  = 0;
      State.distanceKm = 0;
      State.coords = [];
      State.lastCoord = null;
      State.calories = 0;
      State.steps = 0;
      State.hr = 0;
      State.speedBuffer = [];
      State.zoneSeconds = { rest:0, fat:0, cardio:0, vigorous:0, max:0 };
      State.lastMoveTime = Date.now();
      State.lastHydrationTime = Date.now();
      State.goal = Storage.getGoal();
      MapEngine.reset();
      Perf.ecgData = new Array(100).fill(0);
      Intervals.reset();
    } else if (State.status === 'paused') {
      State.pausedMs += Date.now() - State.pauseStart;
    }

    State.status = 'running';
    this.startGPS();
    this.startTimers();
    this.updateUI();
    Audio.speak(`${State.mode} started. Good luck!`);
    Toast.success('Activity started!');
  },

  pause() {
    if (State.status !== 'running') return;
    State.status = 'paused';
    State.pauseStart = Date.now();
    this.stopTimers();
    this.stopGPS();
    this.updateUI();
    Audio.speak('Paused');
  },

  resume() {
    this.start();
  },

  stop() {
    if (State.status === 'idle') return;
    this.stopTimers();
    this.stopGPS();
    const session = this.buildSession();
    State.status = 'idle';
    State.goal = null;
    this.updateUI();
    if (session.distanceKm > 0.01 || session.durationMs >= 10000) {
      SupaStorage.addWorkout(session);
      Achievements.checkAll(session);
      SessionSummary.show(session);
      Social.addToFeed(session);
      Insights.invalidate();
    } else {
      Toast.info('Short activity discarded');
    }
    MapEngine.reset();
    document.getElementById('nav-track-btn').classList.remove('running');
  },

  buildSession() {
    const elapsed = this.getElapsedMs();
    const paceSecPerKm = elapsed > 0 && State.distanceKm > 0 ? (elapsed / 1000) / State.distanceKm : 0;
    return {
      id: Date.now(),
      date: new Date().toISOString(),
      mode: State.mode,
      distanceKm: parseFloat(State.distanceKm.toFixed(3)),
      durationMs: elapsed,
      avgPaceSecPerKm: parseFloat(paceSecPerKm.toFixed(1)),
      calories: State.calories,
      steps: State.steps,
      avgHR: State.hr,
      maxSpeedKmh: parseFloat(State.maxSpeedKmh.toFixed(1)),
      avgSpeedKmh: parseFloat(State.avgSpeedKmh.toFixed(1)),
      zoneSeconds: { ...State.zoneSeconds },
      coords: State.coords.slice(-500),
    };
  },

  startGPS() {
    if (!navigator.geolocation) { this.setGPSStatus('unavailable'); return; }
    this.setGPSStatus('acquiring');
    State.gpsWatchId = navigator.geolocation.watchPosition(
      pos => this.handleGPS(pos),
      err => this.setGPSStatus('error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  },

  stopGPS() {
    if (State.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(State.gpsWatchId);
      State.gpsWatchId = null;
    }
    this.setGPSStatus('idle');
  },

  handleGPS(pos) {
    const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;
    State.gpsAccuracy = accuracy;
    this.setGPSStatus('tracking', accuracy);

    if (accuracy > 50) return; // ignore low-accuracy fixes

    MapEngine.addPoint(lat, lng, accuracy);

    if (State.lastCoord && State.status === 'running') {
      const [plat, plng] = State.lastCoord;
      const dist = this.haversine(plat, plng, lat, lng);
      if (dist > 0.005 && dist < 0.3) { // filter teleports
        State.distanceKm += dist;
        State.lastMoveTime = Date.now();
      }
    }
    State.lastCoord = [lat, lng];
    State.coords.push([lat, lng]);

    // Speed
    const spd = speed != null ? speed * 3.6 : 0;
    State.speedBuffer.push(spd);
    if (State.speedBuffer.length > 10) State.speedBuffer.shift();
    State.currentSpeedKmh = State.speedBuffer.reduce((a,b) => a+b, 0) / State.speedBuffer.length;
    State.maxSpeedKmh = Math.max(State.maxSpeedKmh, State.currentSpeedKmh);
    const allSpeeds = State.speedBuffer;
    State.avgSpeedKmh = allSpeeds.reduce((a,b) => a+b, 0) / allSpeeds.length;
  },

  setGPSStatus(status, accuracy = null) {
    const dot   = document.getElementById('gps-dot');
    const label = document.getElementById('gps-label');
    if (!dot || !label) return;
    dot.className = 'gps-dot';
    const labels = { idle:'GPS', acquiring:'Locating…', tracking:'GPS Active', error:'GPS Error', unavailable:'No GPS' };
    if (status === 'acquiring') dot.classList.add('acquiring');
    if (status === 'tracking')  { dot.classList.add('tracking'); }
    if (accuracy) label.textContent = `GPS ±${Math.round(accuracy)}m`;
    else label.textContent = labels[status] || status;
  },

  startTimers() {
    State.timerInterval = setInterval(() => {
      this.tick();
    }, 1000);
    Perf.ecgInterval = setInterval(() => Perf.updateECG(), 50);

    const s = Storage.getSettings();
    if (s.safetyAlerts) {
      State.safetyTimer = setInterval(() => {
        if (Date.now() - State.lastMoveTime > 15000 && State.status === 'running') {
          document.getElementById('safety-alert').classList.remove('hidden');
        }
      }, 5000);
    }
    if (s.hydrationReminders) {
      State.hydrationTimer = setInterval(() => {
        if (Date.now() - State.lastHydrationTime > 1800000 && State.status === 'running') {
          document.getElementById('hydration-alert').classList.remove('hidden');
          State.lastHydrationTime = Date.now();
        }
      }, 60000);
    }
  },

  stopTimers() {
    clearInterval(State.timerInterval);
    clearInterval(Perf.ecgInterval);
    clearInterval(State.safetyTimer);
    clearInterval(State.hydrationTimer);
    State.timerInterval = State.safetyTimer = State.hydrationTimer = null;
    Perf.ecgInterval = null;
  },

  tick() {
    if (State.status !== 'running') return;
    Perf.updateHR();
    Perf.updateBodyMetrics();
    Perf.updateCalories();
    Intervals.tick();
    this.updateStats();
    this.checkGoal();
    Audio.checkMilestones();
  },

  updateStats() {
    const elapsed = this.getElapsedMs();
    const pace = elapsed > 0 && State.distanceKm > 0 ? (elapsed / 1000) / State.distanceKm : 0;

    // Track sheet stats
    document.getElementById('s-time').textContent  = this.formatTime(elapsed);
    document.getElementById('s-dist').textContent  = State.distanceKm.toFixed(2);
    document.getElementById('s-pace').textContent  = this.formatPace(pace);
    document.getElementById('s-cal').textContent   = State.calories;

    // Advanced stats
    document.getElementById('adv-hr').textContent     = State.hr || '--';
    document.getElementById('adv-zone').textContent   = Perf.getZoneLabel();
    document.getElementById('adv-steps').textContent  = State.steps;
    document.getElementById('adv-power').textContent  = `${State.powerW}W`;
    document.getElementById('adv-stride').textContent = `${State.strideM}m`;
    document.getElementById('adv-temp').textContent   = `${State.tempC}°`;
    document.getElementById('adv-sweat').textContent  = `${State.sweatMl}ml`;
    document.getElementById('adv-o2').textContent     = `${State.o2Pct}%`;

    // Goal pill
    if (State.goal) this.updateGoalPill();
  },

  updateGoalPill() {
    const g = State.goal;
    if (!g) return;
    const pill = document.getElementById('goal-pill');
    const text = document.getElementById('goal-pill-text');
    pill.classList.remove('hidden');
    let progress = 0, target = g.value, current = 0;
    if (g.type === 'distance') { current = State.distanceKm; }
    else if (g.type === 'time') { current = this.getElapsedMs() / 60000; }
    else if (g.type === 'calories') { current = State.calories; }
    progress = Math.min(100, (current / target) * 100);
    const unit = g.type === 'distance' ? 'km' : g.type === 'time' ? 'min' : 'kcal';
    text.textContent = `Goal: ${current.toFixed(1)} / ${target} ${unit} (${Math.round(progress)}%)`;
    if (progress >= 100) {
      Toast.success('🎯 Goal achieved!');
      Audio.speak('Goal achieved! Congratulations!');
      Storage.setGoal(null);
      State.goal = null;
      pill.classList.add('hidden');
    }
  },

  checkGoal() { /* Called from tick, handled in updateGoalPill */ },

  updateUI() {
    const running = State.status === 'running';
    const paused  = State.status === 'paused';
    const idle    = State.status === 'idle';

    const btnMain    = document.getElementById('btn-track-main');
    const btnStop    = document.getElementById('btn-track-stop');
    const iconPlay   = document.getElementById('icon-play');
    const iconPause  = document.getElementById('icon-pause');
    const modeSel    = document.getElementById('mode-selector');
    const modeRunBadge = document.getElementById('mode-run-badge');
    const navTrack   = document.getElementById('nav-track-btn');
    const modeInfo   = MODES[State.mode] || MODES.running;

    if (idle) {
      btnMain.classList.remove('running', 'paused');
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      btnStop.classList.add('hidden');
      modeSel.classList.remove('hidden-selector');
      if (modeRunBadge) modeRunBadge.classList.add('hidden');
      navTrack.classList.remove('running');
      // Reset primary button color to brand
      btnMain.style.background = '';
      btnMain.style.boxShadow  = '';
    } else if (running) {
      btnMain.classList.add('running'); btnMain.classList.remove('paused');
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      btnStop.classList.remove('hidden');
      modeSel.classList.add('hidden-selector');
      navTrack.classList.add('running');
      // Color the run button with mode color
      btnMain.style.background = modeInfo.color;
      btnMain.style.boxShadow  = `0 4px 24px ${modeInfo.color}55`;
      // Show mode badge
      if (modeRunBadge) {
        modeRunBadge.classList.remove('hidden');
        modeRunBadge.style.borderColor = modeInfo.color + '55';
        document.getElementById('mode-run-icon').textContent = modeInfo.icon;
        document.getElementById('mode-run-name').textContent = modeInfo.name;
      }
    } else if (paused) {
      btnMain.classList.add('paused'); btnMain.classList.remove('running');
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      btnStop.classList.remove('hidden');
      modeSel.classList.add('hidden-selector');
      if (modeRunBadge) {
        modeRunBadge.classList.remove('hidden');
        document.getElementById('mode-run-name').textContent = `${modeInfo.name} — Paused`;
      }
    }
  },
};

/* ════════════════════════════════════════
   AUDIO ENGINE
════════════════════════════════════════ */
const Audio = {
  lastKm: 0,
  lastPaceAlert: 0,
  queue: [],
  speaking: false,

  speak(text) {
    const s = Storage.getSettings();
    if (!s.audioOn || !window.speechSynthesis) return;
    this.queue.push(text);
    if (!this.speaking) this.processQueue();
  },

  processQueue() {
    if (!this.queue.length) { this.speaking = false; return; }
    this.speaking = true;
    const utter = new SpeechSynthesisUtterance(this.queue.shift());
    utter.rate = 0.95; utter.volume = 0.8;
    utter.onend = () => setTimeout(() => this.processQueue(), 300);
    speechSynthesis.speak(utter);
  },

  checkMilestones() {
    const km = Math.floor(State.distanceKm);
    if (km > 0 && km !== this.lastKm) {
      this.lastKm = km;
      const pace = Tracker.formatPace((Tracker.getElapsedMs() / 1000) / State.distanceKm);
      this.speak(`${km} kilometre${km > 1 ? 's' : ''}. Pace ${pace} per km.`);
    }
  },
};

/* ════════════════════════════════════════
   INTERVALS ENGINE
════════════════════════════════════════ */
const Intervals = {
  config: null,

  start(work, rest, reps) {
    this.config = { work, rest, reps, current: 0 };
    State.intervalActive = true;
    State.intervalRep = 0;
    State.intervalPhase = 'work';
    State.intervalPhaseStart = Date.now();
    document.getElementById('interval-hud').classList.remove('hidden');
    this.update();
    Audio.speak(`Interval training started. ${reps} reps. Work phase, ${work} seconds.`);
  },

  tick() {
    if (!State.intervalActive || !this.config) return;
    const elapsed = (Date.now() - State.intervalPhaseStart) / 1000;
    const phaseLen = State.intervalPhase === 'work' ? this.config.work : this.config.rest;
    const remaining = Math.max(0, phaseLen - elapsed);

    if (remaining <= 0) {
      if (State.intervalPhase === 'work') {
        State.intervalPhase = 'rest';
        Audio.speak('Rest!');
      } else {
        State.intervalRep++;
        if (State.intervalRep >= this.config.reps) {
          this.complete();
          return;
        }
        State.intervalPhase = 'work';
        Audio.speak(`Rep ${State.intervalRep + 1}. Work!`);
      }
      State.intervalPhaseStart = Date.now();
    }
    this.update();
  },

  update() {
    if (!State.intervalActive || !this.config) return;
    const elapsed = (Date.now() - State.intervalPhaseStart) / 1000;
    const phaseLen = State.intervalPhase === 'work' ? this.config.work : this.config.rest;
    const remaining = Math.max(0, phaseLen - elapsed);
    const progress = Math.min(100, (elapsed / phaseLen) * 100);

    document.getElementById('ihud-phase').textContent = State.intervalPhase.toUpperCase();
    document.getElementById('ihud-timer').textContent = Math.ceil(remaining);
    document.getElementById('ihud-rep').textContent   = `Rep ${State.intervalRep + 1} / ${this.config.reps}`;
    document.getElementById('ihud-fill').style.width  = `${progress}%`;

    const hud = document.getElementById('interval-hud');
    hud.style.borderColor = State.intervalPhase === 'work' ? 'rgba(255,101,0,0.4)' : 'rgba(0,217,126,0.3)';
  },

  complete() {
    State.intervalActive = false;
    document.getElementById('interval-hud').classList.add('hidden');
    Toast.success('Intervals complete! Great work!');
    Audio.speak('All intervals complete! Great work!');
  },

  reset() {
    State.intervalActive = false;
    this.config = null;
    document.getElementById('interval-hud').classList.add('hidden');
  },
};

/* ════════════════════════════════════════
   ACHIEVEMENT ENGINE
════════════════════════════════════════ */
const Achievements = {
  DEFS: [
    { id: 'first_steps',    icon: '👟', name: 'First Steps',         desc: 'Complete your first activity' },
    { id: 'club_5k',        icon: '5️⃣', name: '5K Club',            desc: 'Run 5km in a single session' },
    { id: 'club_10k',       icon: '🔟', name: '10K Runner',          desc: 'Run 10km in a single session' },
    { id: 'half_marathon',  icon: '🌓', name: 'Half Marathon',        desc: 'Cover 21.1km in one session' },
    { id: 'marathon',       icon: '🏅', name: 'Marathon',             desc: 'Complete a full marathon 42.2km' },
    { id: 'speed_demon',    icon: '⚡', name: 'Speed Demon',          desc: 'Average pace under 4:30/km' },
    { id: 'early_bird',     icon: '🌅', name: 'Early Bird',           desc: 'Complete a run before 7 AM' },
    { id: 'night_owl',      icon: '🌙', name: 'Night Owl',            desc: 'Complete a run after 9 PM' },
    { id: 'streak_7',       icon: '🔥', name: 'On Fire',              desc: '7-day running streak' },
    { id: 'streak_30',      icon: '💎', name: 'Dedicated',            desc: '30-day running streak' },
    { id: 'century',        icon: '💯', name: 'Century',              desc: 'Log 100 total activities' },
    { id: 'dist_100',       icon: '🏆', name: 'Distance King',        desc: 'Run 100km total' },
    { id: 'calorie_crusher',icon: '🔥', name: 'Calorie Crusher',      desc: 'Burn 1000 kcal in one session' },
    { id: 'social_star',    icon: '⭐', name: 'Community Star',       desc: 'Add 5 friends' },
    { id: 'challenger',     icon: '🎯', name: 'Challenger',           desc: 'Join 3 challenges' },
    { id: 'comeback',       icon: '🔄', name: 'Comeback Kid',         desc: 'Return after 30+ days off' },
    { id: 'explorer',       icon: '🗺️', name: 'Explorer',            desc: 'Complete 10 total activities' },
    { id: 'ironwill',       icon: '🦾', name: 'Iron Will',            desc: 'Complete a run in bad weather' },
    { id: 'ultramarathon',  icon: '🚀', name: 'Ultra Runner',         desc: 'Cover 50km in one session' },
    { id: 'elite',          icon: '👑', name: 'Elite Runner',         desc: 'Log 50 total activities' },
  ],

  checkAll(session) {
    const history = Storage.getHistory();
    const badges  = Storage.getBadges();
    const earned  = [];

    const unlock = (id) => {
      if (!badges[id]) {
        badges[id] = { date: Date.now() };
        earned.push(id);
      }
    };

    // Check conditions
    if (history.length >= 1)  unlock('first_steps');
    if (history.length >= 10) unlock('explorer');
    if (history.length >= 50) unlock('elite');
    if (history.length >= 100) unlock('century');
    if (session.distanceKm >= 5)    unlock('club_5k');
    if (session.distanceKm >= 10)   unlock('club_10k');
    if (session.distanceKm >= 21.1) unlock('half_marathon');
    if (session.distanceKm >= 42.2) unlock('marathon');
    if (session.distanceKm >= 50)   unlock('ultramarathon');
    if (session.avgPaceSecPerKm > 0 && session.avgPaceSecPerKm < 270) unlock('speed_demon');
    if (session.calories >= 1000) unlock('calorie_crusher');

    const hour = new Date(session.date).getHours();
    if (hour < 7)  unlock('early_bird');
    if (hour >= 21) unlock('night_owl');

    // Total distance
    const totalKm = history.reduce((s, h) => s + (h.distanceKm || 0), 0);
    if (totalKm >= 100) unlock('dist_100');

    // Friends count
    const friends = Storage.getFriends();
    if (friends.list.length >= 5) unlock('social_star');

    // Challenges
    const challenges = Storage.getChallenges();
    const joined = challenges.filter(c => c.joined).length;
    if (joined >= 3) unlock('challenger');

    SupaStorage.saveBadges(badges);

    // Show badge toasts with delay
    earned.forEach((id, i) => {
      const def = this.DEFS.find(d => d.id === id);
      if (def) setTimeout(() => this.showBadgeToast(def), i * 2000);
    });

    return earned;
  },

  showBadgeToast(def) {
    const toast = document.getElementById('badge-toast');
    document.getElementById('badge-toast-icon').textContent = def.icon;
    document.getElementById('badge-toast-name').textContent = def.name;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
  },

  renderGrid() {
    const grid = document.getElementById('achievement-grid');
    if (!grid) return;

    if (!StripeEngine.isPro()) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;padding:28px 16px;text-align:center;gap:12px;">
          <div style="font-size:36px;">👑</div>
          <div style="font-weight:700;color:var(--text);">Pro Feature</div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.5;">Unlock Achievements &amp; Badges with DRS Pro.</div>
          <button class="btn-pro-upgrade" onclick="StripeEngine.goToCheckout()">Upgrade to Pro — $4.99/mo</button>
        </div>`;
      const countEl = document.getElementById('earned-count');
      if (countEl) countEl.textContent = '🔒 Pro';
      return;
    }

    const badges = Storage.getBadges();
    grid.innerHTML = '';
    let earnedCount = 0;

    this.DEFS.forEach(def => {
      const isEarned = !!badges[def.id];
      if (isEarned) earnedCount++;
      const item = document.createElement('div');
      item.className = `achievement-item ${isEarned ? 'earned' : 'locked'}`;
      item.innerHTML = `<span class="ach-icon">${def.icon}</span>`;
      item.title = def.name;
      item.addEventListener('click', () => {
        document.getElementById('ach-modal-icon').textContent = def.icon;
        document.getElementById('ach-modal-name').textContent = def.name;
        document.getElementById('ach-modal-desc').textContent = def.desc;
        document.getElementById('ach-modal-date').textContent = isEarned
          ? `Earned: ${new Date(badges[def.id].date).toLocaleDateString()}` : 'Not yet earned';
        Modal.open('modal-achievement');
      });
      grid.appendChild(item);
    });

    const countEl = document.getElementById('earned-count');
    if (countEl) countEl.textContent = `${earnedCount} / ${this.DEFS.length}`;
  },
};

/* ════════════════════════════════════════
   SOCIAL ENGINE
════════════════════════════════════════ */
const Social = {
  currentTab: 'feed',
  lbPeriod: 'week',
  lbSort: 'distance',

  refresh() {
    if (!StripeEngine.isPro()) { this.renderProGate(); return; }
    this.renderFeed();
    this.renderLeaderboard();
    this.renderFriends();
    this.renderChallenges();
  },

  async refreshAsync() {
    if (!StripeEngine.isPro()) { this.renderProGate(); return; }
    await Promise.all([this.renderFeed(), this.renderLeaderboard(), this.renderFriends(), this.renderChallenges()]);
  },

  renderProGate() {
    const container = document.getElementById('v-social');
    if (!container) return;
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:70vh;padding:32px;text-align:center;gap:16px;">
        <div style="font-size:48px;">👑</div>
        <div style="font-size:22px;font-weight:700;color:var(--text);">Pro Feature</div>
        <div style="font-size:15px;color:var(--text-2);line-height:1.6;">
          Social Feed, Leaderboard, Friends &amp; Challenges are available on <strong>DRS Pro</strong>.
        </div>
        <button class="btn-pro-upgrade" onclick="StripeEngine.goToCheckout()" style="margin-top:8px;">
          Upgrade to Pro — $4.99/mo
        </button>
      </div>`;
  },

  switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => {
      const isTarget = p.id === `tab-${tab}`;
      p.classList.toggle('active', isTarget);
      p.classList.toggle('hidden', !isTarget);
    });
    this.currentTab = tab;
  },

  addToFeed(session) {
    // Local cache — Supabase insert handled in SupaStorage.addWorkout()
    const profile = Storage.getProfile();
    const feed = Storage.getFeed();
    feed.unshift({
      id: Date.now(), avatar: profile.avatar || '🏃', name: profile.name || 'You',
      text: `Just completed a ${MODES[session.mode]?.name || session.mode}! ${session.distanceKm.toFixed(2)}km in ${Tracker.formatTime(session.durationMs)}.`,
      stats: { dist: session.distanceKm, time: session.durationMs, cal: session.calories, pace: session.avgPaceSecPerKm },
      mode: session.mode, timestamp: Date.now(), likes: 0, liked: false, isOwn: true,
    });
    Storage.setFeed(feed);
  },

  async renderFeed() {
    const container = document.getElementById('feed-list');
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div>Loading feed…</div></div>';
    const uid = Auth.user?.id;
    const { data: posts } = await _supabase
      .from('feed_posts')
      .select('*, profiles(name, avatar)')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!posts?.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📰</div><div>No activities yet. Be the first!</div></div>';
      return;
    }

    // Track which posts the current user has liked
    const { data: myLikes } = uid
      ? await _supabase.from('post_likes').select('post_id').eq('user_id', uid)
      : { data: [] };
    const likedSet = new Set((myLikes || []).map(l => l.post_id));

    container.innerHTML = posts.map(post => {
      const liked = likedSet.has(post.id);
      return `
        <div class="feed-card">
          <div class="feed-card-header">
            <span class="feed-avatar">${post.profiles?.avatar || '🏃'}</span>
            <span class="feed-user-name">${post.profiles?.name || 'Runner'}</span>
            <span class="feed-time">${this.timeAgo(new Date(post.created_at).getTime())}</span>
          </div>
          <div class="feed-body">${post.text || ''}</div>
          <div class="feed-actions">
            <button class="feed-action-btn ${liked ? 'liked' : ''}" data-post-id="${post.id}" data-liked="${liked}">
              ${liked ? '❤️' : '🤍'} ${post.likes || 0}
            </button>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-post-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!uid) { Toast.warning('Sign in to like posts'); return; }
        const postId = btn.dataset.postId;
        const wasLiked = btn.dataset.liked === 'true';
        if (wasLiked) {
          await _supabase.from('post_likes').delete().match({ user_id: uid, post_id: postId });
          await _supabase.from('feed_posts').update({ likes: Math.max(0, parseInt(btn.textContent) - 1) }).eq('id', postId);
        } else {
          await _supabase.from('post_likes').insert({ user_id: uid, post_id: postId });
          await _supabase.from('feed_posts').update({ likes: parseInt(btn.textContent.match(/\d+/)?.[0] || 0) + 1 }).eq('id', postId);
        }
        this.renderFeed();
      });
    });
  },

  async renderLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div>Loading…</div></div>';

    const cutoffDays = this.lbPeriod === 'week' ? 7 : this.lbPeriod === 'month' ? 30 : 36500;
    const cutoff = new Date(Date.now() - cutoffDays * 86400000).toISOString();
    const uid = Auth.user?.id;

    const { data: workouts } = await _supabase
      .from('workouts')
      .select('user_id, distance_km, calories, steps, avg_speed_kmh, profiles(name, avatar)')
      .gte('date', cutoff);

    if (!workouts?.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><div>No data yet</div></div>';
      return;
    }

    // Aggregate by user
    const userMap = {};
    workouts.forEach(w => {
      if (!userMap[w.user_id]) userMap[w.user_id] = { name: w.profiles?.name || 'Runner', avatar: w.profiles?.avatar || '🏃', distance: 0, calories: 0, steps: 0, speed: [], isMe: w.user_id === uid };
      userMap[w.user_id].distance += w.distance_km || 0;
      userMap[w.user_id].calories += w.calories || 0;
      userMap[w.user_id].steps    += w.steps || 0;
      if (w.avg_speed_kmh) userMap[w.user_id].speed.push(w.avg_speed_kmh);
    });

    let entries = Object.values(userMap).map(e => ({ ...e, speed: e.speed.length ? e.speed.reduce((a,b)=>a+b)/e.speed.length : 0 }));
    entries.sort((a, b) => (b[this.lbSort] || 0) - (a[this.lbSort] || 0));
    entries = entries.slice(0, 10);

    list.innerHTML = entries.map((e, i) => {
      const rankClass = i === 0 ? 'top-1' : i === 1 ? 'top-2' : i === 2 ? 'top-3' : '';
      const val = this.lbSort === 'distance' ? e.distance.toFixed(1) : this.lbSort === 'speed' ? e.speed.toFixed(1) : Math.round(e[this.lbSort] || 0);
      return `
        <div class="lb-item ${e.isMe ? 'is-me' : ''}">
          <div class="lb-rank ${rankClass}">${i < 3 ? ['🥇','🥈','🥉'][i] : i+1}</div>
          <div class="lb-avatar">${e.avatar}</div>
          <div class="lb-info"><div class="lb-name">${e.name}${e.isMe ? ' (You)' : ''}</div></div>
          <div class="lb-val">${val}</div>
        </div>`;
    }).join('') || '<div class="empty-state"><div class="empty-icon">🏆</div><div>No data yet</div></div>';
  },

  aggregateHistory(history, period) {
    const now = Date.now();
    const cutoff = period === 'week' ? 7 : period === 'month' ? 30 : 36500;
    const filtered = history.filter(h => (now - new Date(h.date).getTime()) < cutoff * 86400000);
    return {
      distance: filtered.reduce((s, h) => s + (h.distanceKm || 0), 0),
      calories: filtered.reduce((s, h) => s + (h.calories || 0), 0),
      steps:    filtered.reduce((s, h) => s + (h.steps || 0), 0),
      speed:    filtered.length ? filtered.reduce((s, h) => s + (h.avgSpeedKmh || 0), 0) / filtered.length : 0,
    };
  },

  async renderFriends() {
    const uid  = Auth.user?.id;
    const fList = document.getElementById('friends-list');
    const rList = document.getElementById('friend-requests-list');
    const rSection = document.getElementById('friend-requests');
    if (!uid) return;

    // Pending requests sent TO me
    const { data: requests } = await _supabase
      .from('friends')
      .select('id, requester_id, profiles!friends_requester_id_fkey(name, avatar)')
      .eq('addressee_id', uid).eq('status', 'pending');

    if (requests?.length) {
      rSection.classList.remove('hidden');
      rList.innerHTML = requests.map(r => `
        <div class="friend-card">
          <span class="friend-avatar">${r.profiles?.avatar || '👤'}</span>
          <div class="friend-info"><div class="friend-name">${r.profiles?.name || 'Runner'}</div><div class="friend-stat">Wants to be friends</div></div>
          <div class="friend-actions"><button class="friend-btn accept" data-req-id="${r.id}" data-req-name="${r.profiles?.name}">Accept</button></div>
        </div>`).join('');
      rList.querySelectorAll('[data-req-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await _supabase.from('friends').update({ status: 'accepted' }).eq('id', btn.dataset.reqId);
          Toast.success(`Now friends with ${btn.dataset.reqName}!`);
          this.renderFriends();
        });
      });
    } else { rSection.classList.add('hidden'); }

    // Confirmed friends
    const { data: accepted } = await _supabase
      .from('friends')
      .select('requester_id, addressee_id, profiles!friends_requester_id_fkey(name, avatar), profiles!friends_addressee_id_fkey(name, avatar)')
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
      .eq('status', 'accepted');

    if (!accepted?.length) {
      fList.innerHTML = '<div class="empty-state"><div class="empty-icon">👫</div><div>No friends yet. Search to add!</div></div>';
    } else {
      fList.innerHTML = accepted.map(f => {
        const isMe = f.requester_id === uid;
        const profile = isMe ? f['profiles!friends_addressee_id_fkey'] : f['profiles!friends_requester_id_fkey'];
        return `<div class="friend-card">
          <span class="friend-avatar">${profile?.avatar || '👤'}</span>
          <div class="friend-info"><div class="friend-name">${profile?.name || 'Runner'}</div></div>
        </div>`;
      }).join('');
    }
  },

  async renderChallenges() {
    const container = document.getElementById('challenges-list');
    const uid = Auth.user?.id;
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div>Loading…</div></div>';

    const { data: challenges } = await _supabase
      .from('challenges')
      .select('*, challenge_participants(user_id, progress)')
      .order('created_at', { ascending: false });

    if (!challenges?.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><div>No active challenges yet</div></div>';
      return;
    }

    container.innerHTML = challenges.map(c => {
      const myPart  = c.challenge_participants?.find(p => p.user_id === uid);
      const joined  = !!myPart;
      const totalProg = c.challenge_participants?.reduce((s, p) => s + (p.progress || 0), 0) || 0;
      const pct     = Math.min(100, (totalProg / c.target) * 100);
      const unit    = c.type === 'distance' ? 'km' : c.type === 'calories' ? 'kcal' : 'steps';
      return `
        <div class="challenge-card">
          <div class="challenge-header"><span class="challenge-name">${c.name}</span><span class="challenge-type">${c.type}</span></div>
          <div class="challenge-progress-bar"><div class="challenge-progress-fill" style="width:${pct}%"></div></div>
          <div class="challenge-footer">
            <span class="challenge-participants">${totalProg.toFixed(c.type === 'distance' ? 1 : 0)} / ${c.target} ${unit}</span>
            ${!joined ? `<button class="challenge-join-btn" data-ch-id="${c.id}">Join</button>` : '<span style="color:var(--accent-green);font-size:12px;font-weight:700;">✓ Joined</span>'}
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-ch-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!uid) { Toast.warning('Sign in to join challenges'); return; }
        await _supabase.from('challenge_participants').insert({ challenge_id: btn.dataset.chId, user_id: uid });
        Toast.success('Challenge joined!');
        this.renderChallenges();
      });
    });
  },

  timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return `${Math.floor(diff/86400000)}d ago`;
  },

  seedCommunity() {
    // Community data now comes from real Supabase users — no seeding needed
  },
};

/* ════════════════════════════════════════
   INSIGHTS ENGINE
════════════════════════════════════════ */
const Insights = {
  generate() {
    const history = Storage.getHistory();
    if (history.length < 2) return { title: 'Keep going!', body: 'Complete a few more runs to unlock personalized AI insights.' };

    const now = Date.now();
    const thisWeek = history.filter(h => now - new Date(h.date) < 7*86400000);
    const lastWeek = history.filter(h => {
      const age = now - new Date(h.date);
      return age >= 7*86400000 && age < 14*86400000;
    });

    const thisKm = thisWeek.reduce((s,h) => s + h.distanceKm, 0);
    const lastKm = lastWeek.reduce((s,h) => s + h.distanceKm, 0);
    const pctChange = lastKm > 0 ? ((thisKm - lastKm) / lastKm * 100).toFixed(0) : 0;

    const recentPaces = history.slice(-5).filter(h => h.avgPaceSecPerKm > 0).map(h => h.avgPaceSecPerKm);
    const avgPace = recentPaces.length ? recentPaces.reduce((a,b) => a+b, 0) / recentPaces.length : 0;

    const insights = [];
    if (thisKm > lastKm && lastKm > 0) insights.push(`You ran ${pctChange}% more this week vs last week. Great progression! 📈`);
    else if (lastKm > 0) insights.push(`Weekly volume dipped ${Math.abs(pctChange)}%. Consider adding one more easy run.`);
    if (thisWeek.length >= 5) insights.push('High training frequency this week. Make sure to schedule recovery.');
    else if (thisWeek.length <= 1) insights.push('Only 1 run this week — try for 3-4 runs to build aerobic base.');
    if (avgPace > 0 && avgPace < 300) insights.push(`Your pace this week: ${Tracker.formatPace(avgPace)}/km. On track for strong 5K!`);
    if (history.length >= 10) {
      const best = Math.min(...history.filter(h => h.avgPaceSecPerKm > 0).map(h => h.avgPaceSecPerKm));
      insights.push(`Personal best pace: ${Tracker.formatPace(best)}/km. Can you beat it?`);
    }

    const tip = insights.length ? insights[Math.floor(Math.random() * insights.length)] : 'Keep up your training consistency for best results!';
    return { title: 'This Week\'s Insight', body: tip };
  },

  invalidate() {
    Storage.setInsights({ generated: 0, data: [] });
  },

  render() {
    const cached = Storage.getInsights();
    const stale  = Date.now() - cached.generated > 3600000;
    const insight = stale ? this.generate() : (cached.data[0] || this.generate());

    if (stale) Storage.setInsights({ generated: Date.now(), data: [insight] });

    const titleEl = document.getElementById('insight-title');
    const bodyEl  = document.getElementById('insight-body');
    if (titleEl) titleEl.textContent = insight.title;
    if (bodyEl)  bodyEl.textContent  = insight.body;
  },
};

/* ════════════════════════════════════════
   SESSION SUMMARY
════════════════════════════════════════ */
const SessionSummary = {
  show(session) {
    const body = document.getElementById('session-summary-body');
    const totalTime = session.zoneSeconds ? Object.values(session.zoneSeconds).reduce((a,b)=>a+b,0) : 1;
    const zonePct = zone => Math.round(((session.zoneSeconds?.[zone] || 0) / Math.max(1, totalTime)) * 100);

    const badges = Achievements.DEFS.filter(d => {
      const b = Storage.getBadges();
      return b[d.id] && Math.abs(new Date(session.date).getTime() - b[d.id].date) < 5000;
    });

    body.innerHTML = `
      <div class="summary-hero">
        <div class="summary-mode-icon">${MODES[session.mode]?.icon || '🏃'}</div>
        <div class="summary-distance">${session.distanceKm.toFixed(2)}</div>
        <div class="summary-dist-unit">km</div>
      </div>
      <div class="summary-stats-grid">
        <div class="ss-card"><div class="ss-card-val">${Tracker.formatTime(session.durationMs)}</div><div class="ss-card-lbl">Duration</div></div>
        <div class="ss-card"><div class="ss-card-val">${Tracker.formatPace(session.avgPaceSecPerKm)}</div><div class="ss-card-lbl">Avg Pace</div></div>
        <div class="ss-card"><div class="ss-card-val">${session.calories}</div><div class="ss-card-lbl">kcal</div></div>
        <div class="ss-card"><div class="ss-card-val">${session.avgHR || '--'}</div><div class="ss-card-lbl">Avg HR</div></div>
        <div class="ss-card"><div class="ss-card-val">${session.steps || 0}</div><div class="ss-card-lbl">Steps</div></div>
        <div class="ss-card"><div class="ss-card-val">${session.maxSpeedKmh}</div><div class="ss-card-lbl">Max km/h</div></div>
      </div>
      <div class="summary-zones">
        <div class="zones-title">Heart Rate Zones</div>
        <div class="zones-bars">
          ${[['rest','Rest',zonePct('rest')],['fat','Fat Burn',zonePct('fat')],['cardio','Cardio',zonePct('cardio')],['vigorous','Vigorous',zonePct('vigorous')],['max','Max',zonePct('max')]].map(([z,l,p]) => `
            <div class="zone-row">
              <span class="zone-row-label">${l}</span>
              <div class="zone-row-bar"><div class="zone-row-fill ${z}" style="width:${p}%"></div></div>
              <span class="zone-row-pct">${p}%</span>
            </div>
          `).join('')}
        </div>
      </div>
      ${badges.length ? `<div class="summary-badges">
        <div class="zones-title">Achievements Unlocked</div>
        <div class="badges-earned-row">
          ${badges.map(b => `<div class="earned-badge"><span>${b.icon}</span><span>${b.name}</span></div>`).join('')}
        </div>
      </div>` : ''}
      <div class="summary-actions">
        <button class="btn-secondary" id="btn-summary-share">📤 Share</button>
        <button class="btn-primary modal-close" data-close="modal-session">Done</button>
      </div>
    `;

    document.getElementById('btn-summary-share')?.addEventListener('click', () => {
      Modal.close('modal-session');
      Share.showCard(session);
    });

    Modal.open('modal-session');
  },
};

/* ════════════════════════════════════════
   SHARE ENGINE
════════════════════════════════════════ */
const Share = {
  showCard(session) {
    const profile = Storage.getProfile();
    const card = document.getElementById('share-card');
    card.innerHTML = `
      <div class="share-card-header">
        <span class="share-card-avatar">${profile.avatar || '🏃'}</span>
        <div>
          <div class="share-card-name">${profile.name || 'Runner'}</div>
          <div class="share-card-date">${new Date(session.date).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}</div>
        </div>
        <span style="margin-left:auto;font-size:28px">${MODES[session.mode]?.icon||'🏃'}</span>
      </div>
      <div class="share-card-distance">${session.distanceKm.toFixed(2)}</div>
      <div class="share-card-dist-unit">kilometers</div>
      <div class="share-card-stats">
        <div class="scs-item"><div class="scs-val">${Tracker.formatTime(session.durationMs)}</div><div class="scs-lbl">Time</div></div>
        <div class="scs-item"><div class="scs-val">${Tracker.formatPace(session.avgPaceSecPerKm)}/km</div><div class="scs-lbl">Pace</div></div>
        <div class="scs-item"><div class="scs-val">${session.calories} kcal</div><div class="scs-lbl">Burn</div></div>
      </div>
      <div class="share-card-brand">DRS</div>
    `;

    document.getElementById('btn-share-copy').onclick = () => {
      const text = `🏃 Just ran ${session.distanceKm.toFixed(2)}km in ${Tracker.formatTime(session.durationMs)} at ${Tracker.formatPace(session.avgPaceSecPerKm)}/km — powered by DRS!`;
      if (navigator.share) {
        navigator.share({ title: 'My Workout', text }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => Toast.success('Copied to clipboard!'));
      }
    };

    document.getElementById('btn-share-post').onclick = () => {
      Modal.close('modal-share');
      Toast.success('Posted to feed!');
    };

    Modal.open('modal-share');
  },
};

/* ════════════════════════════════════════
   HOME ENGINE
════════════════════════════════════════ */
const Home = {
  refresh() {
    const profile  = Storage.getProfile();
    const history  = Storage.getHistory();
    const settings = Storage.getSettings();
    const now      = new Date();
    const hour     = now.getHours();

    // Greeting
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const greetEl = document.getElementById('home-greeting');
    const nameEl  = document.getElementById('home-name');
    const avEl    = document.getElementById('home-avatar');
    if (greetEl) greetEl.textContent = greeting;
    if (nameEl)  nameEl.textContent  = profile.name || 'Runner';
    if (avEl)    avEl.textContent    = profile.avatar || '🏃';

    // Streak
    this.renderStreak(history);

    // Week stats
    this.renderWeekStats(history);

    // Bar chart
    this.renderWeekChart(history);

    // Last activity
    this.renderLastActivity(history);

    // AI insights
    Insights.render();
  },

  calcStreak(history) {
    if (!history.length) return 0;
    const today = new Date(); today.setHours(0,0,0,0);
    const days = new Set(history.map(h => new Date(h.date).toDateString()));
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      if (days.has(d.toDateString())) streak++;
      else if (i > 0) break;
    }
    return streak;
  },

  renderStreak(history) {
    const streak = this.calcStreak(history);
    const countEl = document.getElementById('streak-count');
    const subEl   = document.getElementById('streak-sub');
    if (countEl) countEl.textContent = streak;
    if (subEl)   subEl.textContent   = streak > 0 ? `Keep it up! 🎉` : 'Start your streak today!';
  },

  renderWeekStats(history) {
    const now = Date.now();
    const week = history.filter(h => now - new Date(h.date) < 7*86400000);
    const dist = week.reduce((s,h) => s + h.distanceKm, 0);
    const time = week.reduce((s,h) => s + h.durationMs, 0);
    const cal  = week.reduce((s,h) => s + h.calories, 0);

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('wk-dist', dist.toFixed(1));
    set('wk-runs', week.length);
    set('wk-time', time > 3600000 ? `${(time/3600000).toFixed(1)}h` : `${Math.floor(time/60000)}m`);
    set('wk-cal',  Math.round(cal));
  },

  renderWeekChart(history) {
    const container = document.getElementById('week-bars');
    if (!container) return;
    const now = new Date(); now.setHours(23,59,59,999);

    // Last 7 days (Mon–Sun)
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      days.push(d.toDateString());
    }

    const dayKm = days.map(ds => history.filter(h => new Date(h.date).toDateString() === ds).reduce((s,h) => s + h.distanceKm, 0));
    const maxKm = Math.max(...dayKm, 0.001);
    const labels = ['M','T','W','T','F','S','S'];

    container.innerHTML = days.map((ds, i) => {
      const pct = Math.round((dayKm[i] / maxKm) * 100);
      const isToday = ds === new Date().toDateString();
      const hasData = dayKm[i] > 0;
      return `<div class="bar-group ${isToday ? 'today' : ''}">
        <div class="bar ${hasData ? 'has-data' : ''}" style="height:${Math.max(4, pct)}%" title="${dayKm[i].toFixed(1)}km"></div>
        <span>${labels[i]}</span>
      </div>`;
    }).join('');
  },

  renderLastActivity(history) {
    const el = document.getElementById('last-activity-card');
    if (!el) return;
    if (!history.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">👟</div><div>No activities yet. Start your first run!</div></div>';
      return;
    }
    const last = history[history.length - 1];
    el.innerHTML = `
      <div class="activity-card-inner">
        <div class="activity-card-header">
          <div class="activity-card-mode">
            <span>${MODES[last.mode]?.icon || '🏃'}</span>
            <span>${MODES[last.mode]?.name || (last.mode||'Run')}</span>
          </div>
          <div class="activity-card-date">${new Date(last.date).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
        </div>
        <div class="activity-card-stats">
          <div class="acs-item"><div class="acs-val text-brand">${(last.distanceKm||0).toFixed(2)}</div><div class="acs-lbl">km</div></div>
          <div class="acs-item"><div class="acs-val">${Tracker.formatTime(last.durationMs||0)}</div><div class="acs-lbl">time</div></div>
          <div class="acs-item"><div class="acs-val">${Tracker.formatPace(last.avgPaceSecPerKm||0)}</div><div class="acs-lbl">pace</div></div>
          <div class="acs-item"><div class="acs-val">${last.calories||0}</div><div class="acs-lbl">kcal</div></div>
        </div>
      </div>
    `;
  },
};

/* ════════════════════════════════════════
   PROFILE ENGINE
════════════════════════════════════════ */
const Profile = {
  refresh() {
    const profile  = Storage.getProfile();
    const history  = Storage.getHistory();
    const settings = Storage.getSettings();

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    const av = document.getElementById('profile-avatar-big');
    if (av) av.textContent = profile.avatar || '🏃';
    set('profile-name',   profile.name || 'Runner');
    set('profile-joined', `Runner since ${new Date(profile.joinedAt || Date.now()).toLocaleDateString('en-US', { month:'long', year:'numeric' })}`);

    // All-time stats
    const totalDist = history.reduce((s,h) => s + (h.distanceKm||0), 0);
    const totalTime = history.reduce((s,h) => s + (h.durationMs||0), 0);
    const totalCal  = history.reduce((s,h) => s + (h.calories||0), 0);

    set('ps-dist', totalDist.toFixed(1));
    set('ps-runs', history.length);
    set('ps-time', totalTime > 3600000 ? `${(totalTime/3600000).toFixed(0)}h` : `${Math.floor(totalTime/60000)}m`);
    set('ps-cal',  Math.round(totalCal));

    // Sign-in banner for guests
    const banner = document.getElementById('profile-signin-banner');
    if (banner) banner.classList.toggle('hidden', !!Auth.user);

    // Achievements
    Achievements.renderGrid();
  },

  showPerformance() {
    const history = Storage.getHistory();
    const body = document.getElementById('perf-dashboard-body');

    if (history.length < 2) {
      body.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div>Complete more runs to unlock performance analytics</div></div>';
      Modal.open('modal-performance');
      return;
    }

    const now = Date.now();
    const week  = history.filter(h => now - new Date(h.date) < 7*86400000);
    const month = history.filter(h => now - new Date(h.date) < 30*86400000);
    const pweek = history.filter(h => { const a = now - new Date(h.date); return a >= 7*86400000 && a < 14*86400000; });

    const wDist  = week.reduce((s,h) => s + h.distanceKm, 0);
    const pwDist = pweek.reduce((s,h) => s + h.distanceKm, 0);
    const distTrend = pwDist > 0 ? ((wDist - pwDist)/pwDist*100).toFixed(0) : null;

    const avgPaces = month.filter(h => h.avgPaceSecPerKm > 0).map(h => h.avgPaceSecPerKm);
    const avgPace  = avgPaces.length ? avgPaces.reduce((a,b)=>a+b,0)/avgPaces.length : 0;
    const bestPace = avgPaces.length ? Math.min(...avgPaces) : 0;

    const bestDist = Math.max(...history.map(h => h.distanceKm));
    const totalCal = month.reduce((s,h) => s + h.calories, 0);

    const insights = Insights.generate();

    body.innerHTML = `
      <div class="perf-section">
        <div class="perf-section-title">This Week</div>
        <div class="perf-stat-row">
          <div class="perf-stat-card">
            <div class="perf-stat-val text-brand">${wDist.toFixed(1)} km</div>
            <div class="perf-stat-lbl">Weekly Distance</div>
            ${distTrend !== null ? `<div class="perf-trend ${distTrend >= 0 ? 'up' : 'down'}">${distTrend >= 0 ? '↑' : '↓'} ${Math.abs(distTrend)}% vs last week</div>` : ''}
          </div>
          <div class="perf-stat-card">
            <div class="perf-stat-val">${week.length}</div>
            <div class="perf-stat-lbl">Runs This Week</div>
          </div>
        </div>
      </div>
      <div class="perf-section">
        <div class="perf-section-title">Pace & Speed</div>
        <div class="perf-stat-row">
          <div class="perf-stat-card">
            <div class="perf-stat-val">${Tracker.formatPace(avgPace)}</div>
            <div class="perf-stat-lbl">Avg Pace / km</div>
          </div>
          <div class="perf-stat-card">
            <div class="perf-stat-val text-brand">${Tracker.formatPace(bestPace)}</div>
            <div class="perf-stat-lbl">Best Pace / km</div>
          </div>
        </div>
      </div>
      <div class="perf-section">
        <div class="perf-section-title">Records</div>
        <div class="perf-stat-row">
          <div class="perf-stat-card">
            <div class="perf-stat-val">${bestDist.toFixed(2)} km</div>
            <div class="perf-stat-lbl">Longest Run</div>
          </div>
          <div class="perf-stat-card">
            <div class="perf-stat-val">${Math.round(totalCal)}</div>
            <div class="perf-stat-lbl">kcal This Month</div>
          </div>
        </div>
      </div>
      <div class="perf-section">
        <div class="perf-section-title">🤖 AI Coaching</div>
        <div class="insight-card" style="margin:0">
          <div class="insight-icon">🤖</div>
          <div class="insight-content">
            <div class="insight-title">${insights.title}</div>
            <div class="insight-body">${insights.body}</div>
          </div>
        </div>
      </div>
    `;
    Modal.open('modal-performance');
  },

  showHistory() {
    const history = Storage.getHistory();
    const body = document.getElementById('history-body');

    if (!history.length) {
      body.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div>No activities yet</div></div>';
      Modal.open('modal-history');
      return;
    }

    body.innerHTML = `<div class="history-list">${[...history].reverse().map((s, i) => `
      <div class="history-card">
        <div class="history-card-icon">${MODES[s.mode]?.icon||'🏃'}</div>
        <div class="history-card-info">
          <div class="history-card-title">${MODES[s.mode]?.name || (s.mode||'Run')}</div>
          <div class="history-card-date">${new Date(s.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
          <div class="history-card-stats">
            <span class="hcs-item"><strong>${(s.distanceKm||0).toFixed(2)}</strong> km</span>
            <span class="hcs-item"><strong>${Tracker.formatTime(s.durationMs||0)}</strong></span>
            <span class="hcs-item"><strong>${Tracker.formatPace(s.avgPaceSecPerKm||0)}</strong>/km</span>
          </div>
        </div>
        <button class="history-card-del" data-del="${history.length - 1 - i}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    `).join('')}</div>`;

    body.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.del);
        const h2 = Storage.getHistory();
        h2.splice(idx, 1);
        Storage.setHistory(h2);
        Toast.info('Activity deleted');
        this.showHistory();
        Insights.invalidate();
      });
    });

    Modal.open('modal-history');
  },
};

/* ════════════════════════════════════════
   GOAL ENGINE
════════════════════════════════════════ */
const Goal = {
  type: 'distance',

  init() {
    document.querySelectorAll('.goal-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.goal-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.type = btn.dataset.gtype;
        this.updatePresets();
      });
    });

    document.querySelectorAll('.goal-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.goal-preset').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('goal-val').value = btn.dataset.val;
      });
    });

    document.getElementById('btn-set-goal-confirm').addEventListener('click', () => {
      const val = parseFloat(document.getElementById('goal-val').value);
      if (!val || isNaN(val)) { Toast.warning('Enter a valid goal value'); return; }
      Storage.setGoal({ type: this.type, value: val });
      State.goal = { type: this.type, value: val };
      Toast.success(`Goal set: ${val} ${this.type === 'distance' ? 'km' : this.type === 'time' ? 'min' : 'kcal'}`);
      Modal.close('modal-goal');
    });

    document.getElementById('btn-clear-goal').addEventListener('click', () => {
      Storage.setGoal(null);
      State.goal = null;
      document.getElementById('goal-pill').classList.add('hidden');
      Toast.info('Goal cleared');
      Modal.close('modal-goal');
    });
  },

  updatePresets() {
    const container = document.getElementById('goal-presets');
    const unit = document.getElementById('goal-unit');
    const presets = {
      distance: [['5','5 km'],['10','10 km'],['21.1','Half Marathon'],['42.2','Marathon']],
      time:     [['20','20 min'],['30','30 min'],['60','1 hour'],['120','2 hours']],
      calories: [['200','200 kcal'],['500','500 kcal'],['1000','1000 kcal'],['2000','2000 kcal']],
    };
    const unitLabels = { distance:'km', time:'min', calories:'kcal' };
    const ps = presets[this.type] || presets.distance;
    container.innerHTML = ps.map(([v, l]) => `<button class="goal-preset" data-val="${v}">${l}</button>`).join('');
    if (unit) unit.textContent = unitLabels[this.type];
    container.querySelectorAll('.goal-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.goal-preset').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('goal-val').value = btn.dataset.val;
      });
    });
  },
};

/* ════════════════════════════════════════
   SETTINGS ENGINE
════════════════════════════════════════ */
const Settings = {
  open() {
    const s = Storage.getSettings();
    const p = Storage.getProfile();
    document.getElementById('set-name').value    = p.name || '';
    document.getElementById('set-weight').value  = s.weightKg || 70;
    document.getElementById('set-age').value     = s.age || 25;
    document.getElementById('set-rhr').value     = s.restingHR || 60;
    document.getElementById('set-audio').checked    = s.audioOn !== false;
    document.getElementById('set-hydration').checked = s.hydrationReminders !== false;
    document.getElementById('set-safety').checked    = s.safetyAlerts !== false;
    Modal.open('modal-settings');
  },

  save() {
    const name   = document.getElementById('set-name').value.trim();
    const weight = parseFloat(document.getElementById('set-weight').value) || 70;
    const age    = parseInt(document.getElementById('set-age').value) || 25;
    const rhr    = parseInt(document.getElementById('set-rhr').value) || 60;

    if (name) { const p = Storage.getProfile(); p.name = name; SupaStorage.saveProfile(p); }
    SupaStorage.saveSettings({
      weightKg: weight, age, restingHR: rhr,
      audioOn: document.getElementById('set-audio').checked,
      hydrationReminders: document.getElementById('set-hydration').checked,
      safetyAlerts: document.getElementById('set-safety').checked,
    });
    Home.refresh();
    Profile.refresh();
    Toast.success('Settings saved!');
    Modal.close('modal-settings');
  },

  clearData() {
    if (!confirm('Clear ALL data? This cannot be undone.')) return;
    localStorage.clear();
    Toast.warning('All data cleared');
    setTimeout(() => location.reload(), 1000);
  },
};

/* ════════════════════════════════════════
   STRIPE ENGINE
   Handles Pro subscription via Stripe Payment Links.
   No backend required — uses Stripe's hosted checkout.

   SETUP (5 minutes):
   1. Go to https://dashboard.stripe.com/products
   2. Click "Add product" → name "DRS Pro" → price $4.99/month recurring
   3. Click "Payment link" on that product → copy the URL
   4. Paste it into STRIPE_PAYMENT_LINK below
   5. In Stripe Dashboard → Payment Links → edit your link
      → set "After payment" redirect to:
        http://localhost:3000/?payment=success    (local dev)
        https://yourdomain.com/?payment=success   (production)
   6. For manage/cancel: Dashboard → Billing → Customer portal → Activate
      Copy portal link into STRIPE_PORTAL_LINK below
════════════════════════════════════════ */
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/test_dRmfZhbTR3eYdpt0ufbbG00';
const STRIPE_PORTAL_LINK  = 'https://billing.stripe.com/p/login/test_dRmfZhbTR3eYdpt0ufbbG00';

const StripeEngine = {

  isPro() { return Storage._get('rt_pro', false) === true; },

  setPro(val) { Storage._set('rt_pro', val); },

  /* Check URL params when returning from Stripe checkout.
     The Supabase webhook sets Pro in the DB; we reload from DB here. */
  async checkReturnFromStripe() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      window.history.replaceState({}, '', window.location.pathname);
      Toast.info('Payment received! Activating Pro…');
      // Wait briefly for the webhook to fire, then reload Pro status
      await new Promise(r => setTimeout(r, 3000));
      await SupaStorage.loadAll();
      this.updateUI();
      if (this.isPro()) Toast.success('Welcome to DRS Pro! All features unlocked.');
      else Toast.warning('Pro activation pending — please refresh in a moment.');
    } else if (params.get('payment') === 'cancelled') {
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => Toast.warning('Upgrade cancelled. You can upgrade anytime from your Profile.'), 600);
    }
  },

  goToCheckout() {
    if (STRIPE_PAYMENT_LINK.includes('YOUR_PAYMENT_LINK')) {
      Toast.error('Stripe not set up yet — add your Payment Link to app.js.');
      return;
    }
    const uid = Auth.user?.id;
    const url = uid ? `${STRIPE_PAYMENT_LINK}?client_reference_id=${uid}` : STRIPE_PAYMENT_LINK;
    window.open(url, '_blank');
    Toast.info("Complete payment in the new tab, then tap \"I've Paid\" below.");
    this.showVerifyBtn();
  },

  showVerifyBtn() {
    if (document.getElementById('btn-verify-payment')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-verify-payment';
    btn.className = 'btn-pro-upgrade';
    btn.style.marginTop = '12px';
    btn.textContent = "I've Paid — Check Status";
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Checking…';
      await SupaStorage.loadAll();
      this.updateUI();
      if (this.isPro()) {
        btn.remove();
        Toast.success('Welcome to DRS Pro! All features unlocked.');
      } else {
        btn.disabled = false;
        btn.textContent = "I've Paid — Check Status";
        Toast.warning('Not confirmed yet — wait a moment and try again.');
      }
    };
    const card = document.getElementById('pro-upgrade-card');
    if (card) card.appendChild(btn);
  },

  goToPortal() {
    if (STRIPE_PORTAL_LINK.includes('YOUR_PORTAL_LINK')) {
      Toast.error('Stripe portal not set up yet — add your Portal Link to app.js.');
      return;
    }
    window.location.href = STRIPE_PORTAL_LINK;
  },

  updateUI() {
    const isPro = this.isPro();
    const badge       = document.getElementById('pro-status-badge');
    const upgradeCard = document.getElementById('pro-upgrade-card');
    const activeCard  = document.getElementById('pro-active-card');
    if (badge)       badge.classList.toggle('hidden', !isPro);
    if (upgradeCard) upgradeCard.classList.toggle('hidden',  isPro);
    if (activeCard)  activeCard.classList.toggle('hidden',  !isPro);
  },

  init() {
    const upgradeBtn = document.getElementById('btn-pro-upgrade');
    if (upgradeBtn) upgradeBtn.addEventListener('click', () => this.goToCheckout());

    const manageBtn = document.getElementById('btn-manage-subscription');
    if (manageBtn) manageBtn.addEventListener('click', () => this.goToPortal());

    this.checkReturnFromStripe();
    this.updateUI();
  },
};

/* ════════════════════════════════════════
   APP CONTROLLER
════════════════════════════════════════ */
const App = {
  async init() {
    // Bind auth modal first (Toast needs DOM ready)
    Modal.init();
    const user = await Auth.init();

    if (user) {
      await SupaStorage.loadAll();
    }
    // Always launch the app — guests can use it for their first activity
    this.initApp();
  },

  _initialized: false,

  initApp() {
    if (this._initialized) return; // Prevent double-binding if called again
    this._initialized = true;
    Nav.init();
    Onboarding.init();
    Perf.init();
    Goal.init();
    Home.refresh();
    StripeEngine.init();

    // Bind track controls
    document.getElementById('btn-track-main').addEventListener('click', () => {
      if (State.status === 'idle')    Tracker.start();
      else if (State.status === 'running') Tracker.pause();
      else if (State.status === 'paused')  Tracker.resume();
    });

    document.getElementById('btn-track-stop').addEventListener('click', () => {
      if (State.status !== 'idle') {
        if (confirm('End this activity?')) Tracker.stop();
      }
    });

    // Mode selector — 8 mode cards
    document.querySelectorAll('.mode-card').forEach(btn => {
      // Apply CSS color variable so active card uses the right color
      const color = btn.dataset.color || '#FF6500';
      btn.style.setProperty('--mc-color', color);

      btn.addEventListener('click', () => {
        if (State.status !== 'idle') return; // lock mode during run
        document.querySelectorAll('.mode-card').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.mode = btn.dataset.mode;
        // Sync polyline color immediately
        if (MapEngine.polyline) {
          MapEngine.polyline.setStyle({ color: MODES[State.mode]?.routeColor || '#FF6500' });
        }
        Toast.info(`Mode: ${MODES[State.mode]?.name || State.mode}`);
      });
    });

    // Advanced drawer toggle
    document.getElementById('adv-toggle-row').addEventListener('click', () => {
      const adv = document.getElementById('sheet-advanced');
      adv.classList.toggle('open');
      const label = document.getElementById('adv-label');
      if (label) label.innerHTML = adv.classList.contains('open')
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Advanced Stats'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Advanced Stats';
    });

    // Interval setup
    document.getElementById('btn-interval-setup').addEventListener('click', () => Modal.open('modal-interval'));

    document.querySelectorAll('.interval-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.interval-preset').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('iv-work').value = btn.dataset.work;
        document.getElementById('iv-rest').value = btn.dataset.rest;
        document.getElementById('iv-reps').value = btn.dataset.reps;
      });
    });

    document.getElementById('btn-start-interval').addEventListener('click', () => {
      const work = parseInt(document.getElementById('iv-work').value) || 30;
      const rest = parseInt(document.getElementById('iv-rest').value) || 30;
      const reps = parseInt(document.getElementById('iv-reps').value) || 8;
      Modal.close('modal-interval');
      if (State.status !== 'running') Tracker.start();
      Intervals.start(work, rest, reps);
    });

    // Settings
    document.getElementById('btn-home-settings').addEventListener('click', () => Settings.open());
    document.getElementById('btn-profile-settings').addEventListener('click', () => Settings.open());
    document.getElementById('btn-save-settings').addEventListener('click', () => Settings.save());
    document.getElementById('btn-clear-data').addEventListener('click', () => Settings.clearData());

    // Goal
    document.getElementById('btn-set-goal').addEventListener('click', () => { Goal.updatePresets(); Modal.open('modal-goal'); });
    document.getElementById('btn-quick-start').addEventListener('click', () => Nav.go('track'));

    // History
    document.getElementById('btn-history').addEventListener('click', () => Profile.showHistory());
    document.getElementById('btn-history-full').addEventListener('click', () => Profile.showHistory());

    // Performance
    document.getElementById('btn-performance').addEventListener('click', () => Profile.showPerformance());
    document.getElementById('btn-perf-dashboard').addEventListener('click', () => Profile.showPerformance());


    // Social tabs
    document.querySelectorAll('#social-tabs .tab').forEach(t => {
      t.addEventListener('click', () => Social.switchTab(t.dataset.tab));
    });

    // Leaderboard filters/sort
    document.querySelectorAll('.lb-filters .pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.lb-filters .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Social.lbPeriod = btn.dataset.period;
        Social.renderLeaderboard();
      });
    });
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Social.lbSort = btn.dataset.sort;
        Social.renderLeaderboard();
      });
    });

    // Profile
    document.getElementById('btn-profile-settings').addEventListener('click', () => Settings.open());

    // Challenges
    document.getElementById('btn-create-challenge').addEventListener('click', () => Modal.open('modal-create-challenge'));
    document.getElementById('btn-create-challenge-confirm').addEventListener('click', async () => {
      const name   = document.getElementById('ch-name').value.trim();
      const type   = document.getElementById('ch-type').value;
      const target = parseFloat(document.getElementById('ch-target').value);
      const days   = parseInt(document.getElementById('ch-days').value) || 30;
      if (!name || !target) { Toast.warning('Fill in all fields'); return; }
      const uid = Auth.user?.id;
      if (!uid) { Toast.warning('Sign in to create challenges'); return; }
      const { data, error } = await _supabase.from('challenges').insert({ creator_id: uid, name, type, target, duration_days: days }).select().single();
      if (error) { Toast.error('Failed to create challenge'); return; }
      // Auto-join the challenge creator
      await _supabase.from('challenge_participants').insert({ challenge_id: data.id, user_id: uid });
      Toast.success('Challenge created!');
      Modal.close('modal-create-challenge');
      Social.renderChallenges();
    });

    // Sign out
    document.getElementById('btn-sign-out')?.addEventListener('click', () => Auth.signOut());

    // Profile sign-in / sign-up banner buttons
    document.getElementById('btn-profile-signin')?.addEventListener('click', () => {
      Auth._isSignUp = false;
      Auth._showModal('Sign in to your account');
    });
    document.getElementById('btn-profile-signup')?.addEventListener('click', () => {
      Auth._isSignUp = true;
      Auth._showModal('Create your account');
      document.getElementById('auth-submit').textContent = 'Create Account';
      document.getElementById('auth-toggle-label').textContent = 'Already have one? Sign in';
      document.getElementById('auth-subtitle').textContent = 'Create your account';
    });

    // Safety / hydration
    document.getElementById('btn-safety-ok').addEventListener('click', () => {
      State.lastMoveTime = Date.now();
      document.getElementById('safety-alert').classList.add('hidden');
    });
    document.getElementById('btn-hydration-ok').addEventListener('click', () => {
      document.getElementById('hydration-alert').classList.add('hidden');
    });

    // Friends search — query real Supabase profiles
    document.getElementById('friends-search')?.addEventListener('input', async (e) => {
      const q = e.target.value.trim();
      const sugList = document.getElementById('suggested-list');
      const sugSection = document.getElementById('friends-suggestions');
      if (!q || q.length < 2) { if (sugSection) sugSection.classList.add('hidden'); return; }
      const uid = Auth.user?.id;
      const { data } = await _supabase.from('profiles').select('id, name, avatar').ilike('name', `%${q}%`).neq('id', uid || '').limit(5);
      if (!data?.length) { if (sugSection) sugSection.classList.add('hidden'); return; }
      if (sugSection) sugSection.classList.remove('hidden');
      if (sugList) {
        sugList.innerHTML = data.map(p => `
          <div class="friend-card">
            <span class="friend-avatar">${p.avatar || '👤'}</span>
            <div class="friend-info"><div class="friend-name">${p.name}</div></div>
            <button class="friend-btn add" data-add-uid="${p.id}" data-add-name="${p.name}">Add</button>
          </div>`).join('');
        sugList.querySelectorAll('[data-add-uid]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!uid) { Toast.warning('Sign in to add friends'); return; }
            const { error } = await _supabase.from('friends').insert({ requester_id: uid, addressee_id: btn.dataset.addUid });
            if (error && error.code === '23505') Toast.info('Request already sent');
            else { Toast.success(`Request sent to ${btn.dataset.addName}!`); btn.textContent = 'Sent'; btn.disabled = true; }
          });
        });
      }
    });

    // Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    console.log('🏃 DRS V2 initialized');
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
