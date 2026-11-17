'use strict';

const net = require('net');
const { EventEmitter } = require('events');

/**
 * Minimal client for the ESPHome native API (the one Home Assistant uses, TCP port 6053).
 * Plaintext transport only (`api:` without `encryption:`).
 *
 * Exposes switches and numbers by object_id, keeps a live state cache and emits
 * 'state' whenever the board reports a change (button presses included).
 */

// ---- message types -------------------------------------------------------
const MSG = {
  HelloRequest: 1,
  HelloResponse: 2,
  ConnectRequest: 3,
  ConnectResponse: 4,
  DisconnectRequest: 5,
  DisconnectResponse: 6,
  PingRequest: 7,
  PingResponse: 8,
  DeviceInfoRequest: 9,
  DeviceInfoResponse: 10,
  ListEntitiesRequest: 11,
  ListEntitiesSwitchResponse: 17,
  ListEntitiesDoneResponse: 19,
  SubscribeStatesRequest: 20,
  SwitchStateResponse: 26,
  SwitchCommandRequest: 33,
  GetTimeRequest: 36,
  GetTimeResponse: 37,
  ListEntitiesNumberResponse: 49,
  NumberStateResponse: 50,
  NumberCommandRequest: 51,
};

// ---- tiny protobuf helpers -----------------------------------------------
function varint(n) {
  const out = [];
  n >>>= 0;
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
  out.push(n);
  return Buffer.from(out);
}

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    if (pos >= buf.length) return null;
    b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return { value: result, pos };
}

const enc = {
  string: (field, s) => {
    const b = Buffer.from(String(s), 'utf8');
    return Buffer.concat([varint((field << 3) | 2), varint(b.length), b]);
  },
  uint: (field, n) => Buffer.concat([varint(field << 3), varint(n)]),
  bool: (field, v) => Buffer.concat([varint(field << 3), varint(v ? 1 : 0)]),
  fixed32: (field, n) => {
    const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0);
    return Buffer.concat([varint((field << 3) | 5), b]);
  },
  float: (field, f) => {
    const b = Buffer.alloc(4); b.writeFloatLE(f);
    return Buffer.concat([varint((field << 3) | 5), b]);
  },
};

/** Decodes a message into { fieldNo: [raw values] }. Wire type 5 kept as Buffer. */
function decode(buf) {
  const fields = {};
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (!tag) break;
    pos = tag.pos;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value & 7;
    let val;
    if (wire === 0) {
      const v = readVarint(buf, pos); val = v.value; pos = v.pos;
    } else if (wire === 2) {
      const l = readVarint(buf, pos); pos = l.pos;
      val = buf.subarray(pos, pos + l.value); pos += l.value;
    } else if (wire === 5) {
      val = buf.subarray(pos, pos + 4); pos += 4;
    } else if (wire === 1) {
      val = buf.subarray(pos, pos + 8); pos += 8;
    } else {
      break;
    }
    (fields[field] = fields[field] || []).push(val);
  }
  const f = {
    str: n => (fields[n] ? fields[n][0].toString('utf8') : ''),
    num: n => (fields[n] ? fields[n][0] : 0),
    bool: n => !!(fields[n] && fields[n][0]),
    fixed32: n => (fields[n] ? fields[n][0].readUInt32LE(0) : 0),
    float: n => (fields[n] ? fields[n][0].readFloatLE(0) : 0),
  };
  return f;
}

/** ESPHome's object_id rule: lower-case, spaces to _, keep [a-z0-9_-]. */
function objectId(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
}

class EspHomeNative extends EventEmitter {

  constructor({ host, port = 6053, password = '', clientInfo = 'Homey ESPHome Relay Fan', timeout = 8000 }) {
    super();
    const [h, p] = String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':');
    this.host = h;
    this.port = Number(p) || Number(port) || 6053;
    this.password = password || '';
    this.clientInfo = clientInfo;
    this.timeout = timeout;
    this.entities = new Map(); // object_id -> { domain, key, id, name, min, max }
    this.byKey = new Map(); // key -> entity
    this.states = new Map(); // key -> value
    this.deviceInfo = null;
    this.connected = false;
    this._closing = false;
  }

  // ---- connection --------------------------------------------------------

  connect() {
    if (this._connecting) return this._connecting;
    if (this.connected) return Promise.resolve();
    this._closing = false;

    this._connecting = new Promise((resolve, reject) => {
      let settled = false;
      const done = err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._connecting = null;
        if (err) {
          this._destroy();
          reject(err);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(() => done(new Error(`Tidsavbrudd mot ${this.host}:${this.port} (ESPHome API)`)), this.timeout);

      this._buf = Buffer.alloc(0);
      this._ready = done;
      this._phase = 'hello';
      this.entities.clear();
      this.byKey.clear();

      const sock = net.createConnection({ host: this.host, port: this.port });
      this.sock = sock;
      sock.setNoDelay(true);
      sock.setKeepAlive(true, 10000);

      sock.on('connect', () => {
        this._send(MSG.HelloRequest, Buffer.concat([
          enc.string(1, this.clientInfo),
          enc.uint(2, 1),
          enc.uint(3, 10),
        ]));
      });
      sock.on('data', chunk => this._onData(chunk));
      sock.on('error', err => {
        const e = err.code === 'ECONNREFUSED'
          ? new Error(`${this.host} svarer ikke på port ${this.port}. Er «api:» aktivert i ESPHome?`)
          : err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH'
            ? new Error(`${this.host} er ikke på nettverket (slått av, eller feil IP?)`)
            : err;
        if (!settled) done(e);
        else this.emit('error', e);
      });
      sock.on('close', () => {
        const was = this.connected;
        this.connected = false;
        clearInterval(this._pinger);
        if (!settled) done(new Error(`${this.host} lukket forbindelsen`));
        if (was) this.emit('disconnected');
      });
    });
    return this._connecting;
  }

  close() {
    this._closing = true;
    if (this.sock && this.connected) {
      try { this._send(MSG.DisconnectRequest, Buffer.alloc(0)); } catch (e) { /* ignore */ }
    }
    this._destroy();
  }

  _destroy() {
    clearInterval(this._pinger);
    this.connected = false;
    if (this.sock) {
      this.sock.removeAllListeners('data');
      this.sock.destroy();
    }
  }

  _send(type, payload) {
    if (!this.sock || this.sock.destroyed) throw new Error('Ikke tilkoblet vifta');
    this.sock.write(Buffer.concat([Buffer.from([0]), varint(payload.length), varint(type), payload]));
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    for (;;) {
      if (!this._buf.length) return;
      if (this._buf[0] !== 0) {
        const err = this._buf[0] === 1
          ? new Error('Kortet bruker kryptert API (api: encryption: key:). Fjern krypteringen i YAML-en, eller be om støtte for nøkkel i appen.')
          : new Error('Ugyldig svar fra kortet');
        if (this._ready) this._ready(err);
        this._destroy();
        return;
      }
      const len = readVarint(this._buf, 1);
      if (!len) return;
      const type = readVarint(this._buf, len.pos);
      if (!type) return;
      if (this._buf.length < type.pos + len.value) return;
      const payload = this._buf.subarray(type.pos, type.pos + len.value);
      this._buf = this._buf.subarray(type.pos + len.value);
      try {
        this._handle(type.value, payload);
      } catch (err) {
        this.emit('error', err);
      }
    }
  }

  _handle(type, payload) {
    const m = decode(payload);
    switch (type) {
      case MSG.HelloResponse:
        // Older firmwares need ConnectRequest; newer ones ignore it. DeviceInfo marks readiness.
        this._send(MSG.ConnectRequest, this.password ? enc.string(1, this.password) : Buffer.alloc(0));
        this._send(MSG.DeviceInfoRequest, Buffer.alloc(0));
        break;
      case MSG.ConnectResponse:
        if (m.bool(1) && this._ready) this._ready(new Error('Feil API-passord'));
        break;
      case MSG.DeviceInfoResponse:
        this.deviceInfo = {
          name: m.str(2),
          mac: m.str(3),
          version: m.str(4),
          model: m.str(6),
          friendlyName: m.str(13) || m.str(2),
        };
        this._send(MSG.ListEntitiesRequest, Buffer.alloc(0));
        break;
      case MSG.ListEntitiesSwitchResponse:
      case MSG.ListEntitiesNumberResponse: {
        const name = m.str(3);
        const ent = {
          domain: type === MSG.ListEntitiesSwitchResponse ? 'switch' : 'number',
          key: m.fixed32(2),
          id: m.str(1) || objectId(name),
          name,
        };
        if (ent.domain === 'number') {
          ent.min = m.float(6);
          ent.max = m.float(7);
        }
        this.entities.set(ent.id, ent);
        this.byKey.set(ent.key, ent);
        break;
      }
      case MSG.ListEntitiesDoneResponse:
        this._send(MSG.SubscribeStatesRequest, Buffer.alloc(0));
        this.connected = true;
        clearInterval(this._pinger);
        this._pinger = setInterval(() => {
          try { this._send(MSG.PingRequest, Buffer.alloc(0)); } catch (e) { /* closed */ }
        }, 20000);
        // give the initial state dump a moment before declaring ready
        setTimeout(() => {
          if (this._ready) { this._ready(); this._ready = null; }
          this.emit('connected');
        }, 300);
        break;
      case MSG.SwitchStateResponse:
        this._setState(m.fixed32(1), m.bool(2));
        break;
      case MSG.NumberStateResponse:
        if (!m.bool(3)) this._setState(m.fixed32(1), m.float(2));
        break;
      case MSG.PingRequest:
        this._send(MSG.PingResponse, Buffer.alloc(0));
        break;
      case MSG.GetTimeRequest:
        this._send(MSG.GetTimeResponse, enc.fixed32(1, Math.floor(Date.now() / 1000)));
        break;
      case MSG.DisconnectRequest:
        try { this._send(MSG.DisconnectResponse, Buffer.alloc(0)); } catch (e) { /* ignore */ }
        this._destroy();
        break;
      default:
        break; // other entity types / responses are not needed
    }
  }

  _setState(key, value) {
    const prev = this.states.get(key);
    this.states.set(key, value);
    const ent = this.byKey.get(key);
    if (ent && prev !== value) this.emit('state', ent, value);
  }

  // ---- public API (same shape as the old HTTP client) --------------------

  _entity(domain, id) {
    const ent = this.entities.get(id) || this.entities.get(objectId(id))
      || [...this.entities.values()].find(e => e.domain === domain && e.name === id);
    if (!ent || ent.domain !== domain) throw new Error(`Fant ikke ${domain} «${id}» på kortet`);
    return ent;
  }

  async getSwitch(id) {
    await this.connect();
    return !!this.states.get(this._entity('switch', id).key);
  }

  async setSwitch(id, on) {
    await this.connect();
    const ent = this._entity('switch', id);
    this._send(MSG.SwitchCommandRequest, Buffer.concat([enc.fixed32(1, ent.key), enc.bool(2, on)]));
  }

  async getNumber(id) {
    await this.connect();
    return Number(this.states.get(this._entity('number', id).key));
  }

  async setNumber(id, value) {
    await this.connect();
    const ent = this._entity('number', id);
    this._send(MSG.NumberCommandRequest, Buffer.concat([enc.fixed32(1, ent.key), enc.float(2, Number(value))]));
  }

  async listEntities() {
    await this.connect();
    return [...this.entities.values()].map(e => ({
      ...e,
      state: e.domain === 'switch' ? !!this.states.get(e.key) : undefined,
      value: this.states.get(e.key),
    }));
  }

}

EspHomeNative.MSG = MSG;
EspHomeNative.objectId = objectId;
module.exports = EspHomeNative;
