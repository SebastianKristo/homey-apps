'use strict';

const http = require('http');

/**
 * Minimal client for the ESPHome `web_server` REST API.
 *
 *   GET  /switch/<id>            -> { id: "switch-relay_1", state: "ON", value: true }
 *   POST /switch/<id>/turn_on
 *   POST /switch/<id>/turn_off
 *   GET  /events                 -> Server-Sent Events, dumps every entity state on connect
 *
 * <id> is the entity's object_id (e.g. "relay_1"). Newer ESPHome versions also
 * accept the entity name; we always use what the board reported to us.
 */
module.exports = class EspHomeApi {

  constructor({ host, username, password, timeout = 5000 }) {
    const [hostname, port] = String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':');
    this.hostname = hostname;
    this.port = Number(port) || 80;
    this.timeout = timeout;
    this.auth = username ? `${username}:${password || ''}` : undefined;
  }

  _request(method, path) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: this.hostname,
        port: this.port,
        path,
        method,
        auth: this.auth,
        timeout: this.timeout,
        headers: { 'Content-Length': 0 },
      }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { body += c; });
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('Unauthorized (check username/password)'));
          if (res.statusCode === 404) return reject(new Error(`Not found: ${path}`));
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} on ${path}`));
          if (!body) return resolve(null);
          try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
        });
      });
      req.on('timeout', () => req.destroy(new Error(`Timeout talking to ${this.hostname}`)));
      req.on('error', reject);
      req.end();
    });
  }

  static _seg(id) {
    return encodeURIComponent(id);
  }

  async getSwitch(id) {
    const r = await this._request('GET', `/switch/${EspHomeApi._seg(id)}`);
    if (!r || typeof r !== 'object') throw new Error(`Unexpected response for switch ${id}`);
    return r.value === true || r.state === 'ON';
  }

  async setSwitch(id, on) {
    await this._request('POST', `/switch/${EspHomeApi._seg(id)}/${on ? 'turn_on' : 'turn_off'}`);
  }

  async getNumber(id) {
    const r = await this._request('GET', `/number/${EspHomeApi._seg(id)}`);
    if (!r || typeof r !== 'object') throw new Error(`Unexpected response for number ${id}`);
    return Number(r.value);
  }

  async setNumber(id, value) {
    await this._request('POST', `/number/${EspHomeApi._seg(id)}/set?value=${encodeURIComponent(value)}`);
  }

  /**
   * Opens /events and collects the initial state dump to discover all switches.
   * Resolves with [{ domain: 'switch'|'number', id, name, state, value, min, max }].
   */
  listEntities(waitMs = 2500) {
    return new Promise((resolve, reject) => {
      const found = new Map();
      let buffer = '';
      let done = false;
      const finish = (err, req) => {
        if (done) return;
        done = true;
        if (req) req.destroy();
        if (err && !found.size) return reject(err);
        resolve([...found.values()]);
      };

      const req = http.request({
        hostname: this.hostname,
        port: this.port,
        path: '/events',
        method: 'GET',
        auth: this.auth,
        headers: { Accept: 'text/event-stream' },
      }, res => {
        if (res.statusCode === 401) return finish(new Error('Unauthorized (check username/password)'), req);
        if (res.statusCode !== 200) return finish(new Error(`HTTP ${res.statusCode} on /events – is web_server enabled?`), req);
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buffer += chunk;
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop();
          for (const ev of events) {
            const type = (ev.match(/^event:\s*(.*)$/m) || [])[1];
            const data = (ev.match(/^data:\s*(.*)$/m) || [])[1];
            if (type !== 'state' || !data) continue;
            try {
              const obj = JSON.parse(data);
              const m = typeof obj.id === 'string' && obj.id.match(/^(switch|number)-(.+)$/);
              if (m) {
                found.set(obj.id, {
                  domain: m[1],
                  id: m[2],
                  name: obj.name || m[2],
                  state: obj.value === true || obj.state === 'ON',
                  value: obj.value,
                  min: obj.min_value,
                  max: obj.max_value,
                });
              }
            } catch (e) { /* ignore */ }
          }
        });
        res.on('end', () => finish(null, req));
      });
      req.on('error', err => finish(err, req));
      req.setTimeout(this.timeout, () => finish(new Error(`Timeout talking to ${this.hostname}`), req));
      req.end();
      setTimeout(() => finish(null, req), waitMs);
    });
  }

};
