'use strict';

const Homey = require('homey');
const EspHomeApi = require('../../lib/EspHomeApi');

module.exports = class FanDriver extends Homey.Driver {

  async onInit() {
    const card = id => this.homey.flow.getActionCard(id);
    card('set_speed').registerRunListener(({ device, speed }) => device.setSpeed(Number(speed)));
    card('run_for').registerRunListener(({ device, speed, minutes }) => device.runFor(Number(speed), minutes));
    card('speed_up').registerRunListener(({ device }) => device.stepSpeed(1));
    card('speed_down').registerRunListener(({ device }) => device.stepSpeed(-1));
    card('set_random').registerRunListener(({ device, state }) => device.setRandom(state === 'on'));
    this.homey.flow.getConditionCard('speed_is')
      .registerRunListener(({ device, speed }) => device.getSpeed() === Number(speed));
    this.speedChanged = this.homey.flow.getDeviceTriggerCard('speed_changed');
  }

  /** Looks at the board and works out whether it runs the Ultimate Fan firmware. */
  async _scan({ host, username, password }) {
    if (!host) throw new Error(this.homey.__('pair.no_host'));
    const api = new EspHomeApi({ host, username, password });
    const entities = await api.listEntities();
    if (!entities.length) throw new Error(this.homey.__('pair.no_entities'));
    const switches = entities.filter(e => e.domain === 'switch');
    const numbers = entities.filter(e => e.domain === 'number');
    const find = (list, re) => (list.find(e => re.test(e.id) || re.test(e.name)) || {});
    const master = find(switches, /^master$/i);
    const speed = find(numbers, /^(fan_?)?speed$/i);
    const random = find(switches, /^random$/i);
    const ultimate = !!(master.id && speed.id);
    return {
      conn: { host: host.trim(), username: username || '', password: password || '' },
      result: {
        ultimate,
        master: master.id || null,
        speed: speed.id || null,
        random: random.id || null,
        maxSpeed: Math.min(4, Math.max(1, Number(speed.max) || 3)),
        switches: switches.map(({ id, name, state }) => ({ id, name, state })),
      },
    };
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

  async onPair(session) {
    let scanned = null;
    session.setHandler('scan', async data => {
      scanned = await this._scan(data);
      return scanned.result;
    });
    session.setHandler('create', async ({ name, relays, type }) => {
      if (!scanned) throw new Error('Scan first');
      const icon = type === 'desk' ? '/desk.svg' : '/tower.svg';
      const settings = this._settings(scanned.conn, scanned.result, relays);
      return {
        name: name || (type === 'desk' ? 'Pultvifte' : 'Ståvifte'),
        icon,
        data: { id: `${scanned.conn.host}:${settings.mode}:${settings.relays || settings.master_id}` },
        settings,
      };
    });
  }

  async onRepair(session, device) {
    let scanned = null;
    session.setHandler('scan', async data => {
      scanned = await this._scan(data);
      return scanned.result;
    });
    session.setHandler('create', async ({ relays }) => {
      await device.setSettings(this._settings(scanned.conn, scanned.result, relays));
      device.reconnect();
      return null;
    });
  }

};
