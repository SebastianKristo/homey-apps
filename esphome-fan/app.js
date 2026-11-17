'use strict';

const Homey = require('homey');

module.exports = class EspHomeFanApp extends Homey.App {
  async onInit() {
    this.log('ESPHome Relay Fan started');
  }
};
