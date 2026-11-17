'use strict';

const FanDriver = require('../../lib/FanDriver');

module.exports = class TowerFanDriver extends FanDriver {
  get fanType() { return 'tower'; }
};
