'use strict';

const FanDriver = require('../../lib/FanDriver');

module.exports = class DeskFanDriver extends FanDriver {
  get fanType() { return 'desk'; }
};
