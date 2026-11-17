'use strict';

const Homey = require('homey');

module.exports = class EspHomeFanApp extends Homey.App {

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
    this.log('ESPHome Relay Fan started');
  }

};
