'use strict';

const Homey = require('homey');
const EspHomeApi = require('../../lib/EspHomeApi');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RECONNECT_KEYS = ['host', 'username', 'password', 'relays', 'poll_interval', 'mode', 'master_id', 'speed_id', 'random_id', 'max_speed'];

/**
 * Two control modes:
 *
 *  - ultimate: board runs the "Ultimate Fan Project" ESPHome config. We drive the
 *    template entities (Master switch, Speed number, Random switch) so the on-board
 *    buttons, LEDs and relay interlock stay in charge and in sync.
 *  - relays:   any ESPHome relay board. One relay per speed; we do the interlock ourselves.
 */
module.exports = class FanDevice extends Homey.Device {

  async onInit() {
    this._queue = Promise.resolve();
    this._lastSpeed = this.getStoreValue('lastSpeed') || 1;

    this.registerCapabilityListener('onoff', on => this.setSpeed(on ? this._lastSpeed : 0));
    this.registerCapabilityListener('fan_speed_step', v => this.setSpeed(Number(v)));
    this.registerCapabilityListener('dim', v => this.setSpeed(this._dimToSpeed(v)));
    this.registerCapabilityListener('fan_random', v => this.setRandom(v));

    this.reconnect();
  }

  reconnect() {
    const s = this.getSettings();
    this.mode = s.mode || 'relays';
    this.api = new EspHomeApi({ host: s.host, username: s.username, password: s.password });
    this.relays = String(s.relays || '').split(',').map(x => x.trim()).filter(Boolean);
    this.maxSpeed = this.mode === 'relays' ? this.relays.length : (s.max_speed || 3);
    this._syncRandomCapability().catch(this.error);
    this.homey.clearInterval(this._poll);
    this._poll = this.homey.setInterval(() => this.poll(), Math.max(2, s.poll_interval || 10) * 1000);
    this.poll();
  }

  async _syncRandomCapability() {
    const want = this.mode === 'ultimate' && !!this.getSetting('random_id');
    const has = this.hasCapability('fan_random');
    if (want && !has) await this.addCapability('fan_random');
    if (!want && has) await this.removeCapability('fan_random');
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.some(k => RECONNECT_KEYS.includes(k))) {
      this.homey.setTimeout(() => this.reconnect(), 100);
    }
  }

  onDeleted() {
    this.homey.clearInterval(this._poll);
    this.homey.clearTimeout(this._runTimer);
  }

  getSpeed() { return Number(this.getCapabilityValue('fan_speed_step') || 0); }

  _dimToSpeed(dim) {
    if (!dim || dim <= 0) return 0;
    return Math.min(this.maxSpeed, Math.max(1, Math.ceil(dim * this.maxSpeed - 1e-9)));
  }

  _speedToDim(speed) {
    return this.maxSpeed ? speed / this.maxSpeed : 0;
  }

  async _reflect(speed, random) {
    const prev = this.getSpeed();
    await this.setCapabilityValue('fan_speed_step', String(speed)).catch(this.error);
    await this.setCapabilityValue('onoff', speed > 0).catch(this.error);
    await this.setCapabilityValue('dim', this._speedToDim(speed)).catch(this.error);
    if (random !== undefined && this.hasCapability('fan_random')) {
      await this.setCapabilityValue('fan_random', random).catch(this.error);
    }
    if (speed > 0 && speed !== this._lastSpeed) {
      this._lastSpeed = speed;
      this.setStoreValue('lastSpeed', speed).catch(this.error);
    }
    // In random mode the speed changes every 2 s – don't spam flows with that.
    if (prev !== speed && !random) {
      this.driver.speedChanged.trigger(this, { speed }).catch(this.error);
    }
  }

  async _readState() {
    if (this.mode === 'ultimate') {
      const s = this.getSettings();
      const [on, speed, random] = await Promise.all([
        this.api.getSwitch(s.master_id),
        this.api.getNumber(s.speed_id),
        s.random_id ? this.api.getSwitch(s.random_id) : Promise.resolve(false),
      ]);
      return { speed: on ? Math.round(speed) : 0, random };
    }
    if (!this.relays.length) throw new Error(this.homey.__('device.no_relays'));
    const states = await Promise.all(this.relays.map(id => this.api.getSwitch(id)));
    let speed = 0;
    states.forEach((on, i) => { if (on) speed = i + 1; });
    return { speed };
  }

  async poll() {
    if (this._busy) return;
    try {
      const { speed, random } = await this._readState();
      if (!this.getAvailable()) await this.setAvailable();
      await this._reflect(speed, random);
    } catch (err) {
      this.error('poll failed:', err.message);
      await this.setUnavailable(err.message).catch(this.error);
    }
  }

  /** Commands are serialised so two quick taps never energise two relays at once. */
  _enqueue(fn) {
    const run = this._queue.then(async () => {
      this._busy = true;
      try { return await fn(); } finally { this._busy = false; }
    });
    this._queue = run.catch(() => {});
    return run;
  }

  setSpeed(speed) {
    this.homey.clearTimeout(this._runTimer);
    return this._enqueue(() => this._applySpeed(speed));
  }

  async _applySpeed(speed) {
    speed = Math.max(0, Math.min(this.maxSpeed, Math.round(speed)));

    if (this.mode === 'ultimate') {
      const s = this.getSettings();
      if (s.random_id && this.getCapabilityValue('fan_random')) {
        await this.api.setSwitch(s.random_id, false);
      }
      if (speed === 0) {
        await this.api.setSwitch(s.master_id, false);
      } else {
        // Set speed first (does nothing while Master is off), then Master on picks the right relay.
        await this.api.setNumber(s.speed_id, speed);
        await this.api.setSwitch(s.master_id, true);
      }
      await this._reflect(speed, false);
      if (!this.getAvailable()) await this.setAvailable();
      return;
    }

    if (!this.relays.length) throw new Error(this.homey.__('device.no_relays'));
    const target = speed > 0 ? this.relays[speed - 1] : null;
    const others = this.relays.filter(id => id !== target);
    await Promise.all(others.map(id => this.api.setSwitch(id, false)));
    if (target) {
      const delay = this.getSetting('interlock_delay');
      if (delay) await sleep(delay);
      await this.api.setSwitch(target, true);
    }
    await this._reflect(speed);
    if (!this.getAvailable()) await this.setAvailable();
  }

  setRandom(on) {
    const id = this.getSetting('random_id');
    if (this.mode !== 'ultimate' || !id) throw new Error(this.homey.__('device.no_random'));
    this.homey.clearTimeout(this._runTimer);
    return this._enqueue(async () => {
      if (on) {
        await this.api.setSwitch(id, true); // firmware turns Master on by itself
      } else {
        await this.api.setSwitch(id, false);
      }
      await this.setCapabilityValue('fan_random', on).catch(this.error);
    });
  }

  async stepSpeed(delta) {
    return this.setSpeed(this.getSpeed() + delta);
  }

  async runFor(speed, minutes) {
    await this.setSpeed(speed);
    this._runTimer = this.homey.setTimeout(() => {
      this.setSpeed(0).catch(this.error);
    }, minutes * 60 * 1000);
  }

};
