'use strict';

const Homey = require('homey');
const EspHomeNative = require('./EspHomeNative');

const normMac = mac => String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');

/**
 * Shared driver for tower and desk fans. Subclasses only set `fanType`.
 *
 * Pairing:
 *  1. Boards announcing `_esphomelib._tcp` on the LAN are found via mDNS.
 *  2. Each board is probed over the web_server REST API. Boards running the
 *     Ultimate Fan firmware (or with "fan"/"vifte" in the name) are suggested first.
 *  3. Manual IP entry is always available as a fallback.
 */
module.exports = class FanDriver extends Homey.Driver {

  get fanType() { return 'tower'; }

  /** All fan devices across both drivers – a board must not be added twice. */
  _takenIds() {
    const ids = new Set();
    for (const id of ['tower', 'desk']) {
      try {
        for (const d of this.homey.drivers.getDriver(id).getDevices()) ids.add(d.getData().id);
      } catch (e) { /* driver not ready */ }
    }
    return ids;
  }

  async _probe({ host, port, password }) {
    if (!host) throw new Error(this.homey.__('pair.no_host'));
    const api = new EspHomeNative({ host, port: port || 6053, password });
    let entities;
    let info;
    try {
      entities = await api.listEntities();
      info = api.deviceInfo || {};
    } finally {
      api.close();
    }
    if (!entities.length) throw new Error(this.homey.__('pair.no_entities'));
    const switches = entities.filter(e => e.domain === 'switch');
    const numbers = entities.filter(e => e.domain === 'number');
    const find = (list, re) => (list.find(e => re.test(e.id) || re.test(e.name)) || {});
    const master = find(switches, /^master$/i);
    const speed = find(numbers, /^(fan_?)?speed$/i);
    const random = find(switches, /^random$/i);
    return {
      mac: normMac(info.mac),
      boardName: info.friendlyName || info.name || '',
      ultimate: !!(master.id && speed.id),
      master: master.id || null,
      speed: speed.id || null,
      random: random.id || null,
      maxSpeed: Math.min(4, Math.max(1, Number(speed.max) || 3)),
      switches: switches.map(({ id, name, state }) => ({ id, name, state })),
    };
  }

  /** Discover ESPHome boards and probe each one. */
  async _discover() {
    let results = {};
    try {
      results = this.homey.discovery.getStrategy('esphome').getDiscoveryResults();
    } catch (err) {
      this.error('discovery unavailable', err.message);
    }
    const taken = this._takenIds();
    const boards = await Promise.all(Object.values(results).map(async r => {
      const txt = r.txt || {};
      const mac = normMac(txt.mac || r.id);
      const board = {
        id: mac || r.address,
        mac,
        host: r.address,
        port: r.port || 6053,
        name: txt.friendly_name || (r.name || '').replace(/\._esphomelib.*$/, '') || r.address,
        hostname: (r.name || '').split('.')[0],
        taken: taken.has(mac) || taken.has(r.address),
      };
      try {
        board.scan = await this._probe({ host: r.address, port: board.port });
        board.ok = true;
      } catch (err) {
        board.ok = false;
        board.error = /passord|password/i.test(err.message) ? 'auth'
          : /krypter|encrypt/i.test(err.message) ? 'encrypted' : 'offline';
      }
      const fanName = /fan|vifte/i.test(`${board.name} ${board.hostname}`);
      board.suggested = !!(board.scan && board.scan.ultimate) || fanName;
      return board;
    }));
    return boards.sort((a, b) => (b.suggested - a.suggested) || a.name.localeCompare(b.name));
  }

  _settings(conn, scan, relays) {
    if (scan.ultimate) {
      return {
        ...conn,
        mode: 'ultimate',
        master_id: scan.master,
        speed_id: scan.speed,
        random_id: scan.random || '',
        max_speed: scan.maxSpeed,
      };
    }
    if (!relays || !relays.length) throw new Error(this.homey.__('pair.no_relays'));
    return { ...conn, mode: 'relays', relays: relays.join(','), max_speed: relays.length };
  }

  _registerHandlers(session, onCreate, repairing = false) {
    let current = null;

    session.setHandler('discover', async () => this._discover());
    session.setHandler('fan_type', async () => this.fanType);

    session.setHandler('scan', async ({ host, port, password, mac, name }) => {
      const scan = await this._probe({ host, port, password });
      if (this._takenIds().has(scan.mac) && !repairing) throw new Error(this.homey.__('pair.already_added'));
      current = {
        conn: { host: String(host).trim(), port: Number(port) || 6053, password: password || '' },
        mac: normMac(mac) || scan.mac,
        boardName: name || scan.boardName,
        scan,
      };
      return scan;
    });

    session.setHandler('create', async ({ name, relays }) => {
      if (!current) throw new Error('Scan first');
      return onCreate(current, this._settings(current.conn, current.scan, relays), name);
    });
  }

  async onPair(session) {
    this._registerHandlers(session, async (cur, settings, name) => {
      const fallback = this.homey.__(`pair.type_${this.fanType}`);
      return {
        name: name || cur.boardName || fallback,
        data: { id: cur.mac || `${cur.conn.host}:${settings.relays || settings.master_id}` },
        settings,
      };
    });
  }

  async onRepair(session, device) {
    this._registerHandlers(session, async (cur, settings) => {
      await device.setSettings(settings);
      device.reconnect();
      return null;
    }, true);
  }

};
