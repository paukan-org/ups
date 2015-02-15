#!/usr/bin/env node

'use strict';

var core = require('paukan-core');
var device = require('./lib/device');
var config = core.common.serviceConfig(require('./config.json'), require('./package.json'));

var service = new core.Service(config);
service.network.local.on('online', function () {
    console.log('Service "%s" is ready', service.id);
    service.loadDevice(device, config.device, function (err) {
        if(err) { throw err; }
        console.log('Device "%s" loaded, available states:', device.id, device.states);
    });
});
