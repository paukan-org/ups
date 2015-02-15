#!/usr/bin/env node

'use strict';

var async = require('async');
var Tail = require('tail').Tail;
var exec = require('exec');
var fs = require('fs');
var pkg = require('../package.json');

function Device() {}

Device.beforeLoad = function(cfg, service, callback) {

    this.cfg = cfg;
    this.service = service;

    this.states = ['power', 'charge', 'timeleft', 'powerstate'];

    var self = this;

    async.series([

        // check if package is installed and paths in config are correct
        function checkFilesExists(next) {

            if (!fs.existsSync(cfg.apcupsdEventFile)) {
                return next(new Error(cfg.apcupsdEventFile + ' dont exists, is apcupsd installed?'));
            }
            if (!fs.existsSync(cfg.apcaccessBinary)) {
                return next(new Error(cfg.apcaccessBinary + ' dont exists, is apcupsd installed?'));
            }
            return next();
        },

        // fill first time info
        function fillDeviceInfo(next) {

            self.getPowerstate(function deviceInfo(err, info) {
                if (err) {
                    return next(err);
                }

                self.id = info.UPSNAME;
                self.version = pkg.version;
                self.description = pkg.description;
                self.homepage = pkg.homepage;
                self.author = pkg.author;
                return next();
            });
        }

    ], callback);
};

Device.afterLoad = function(callback) {

    var self = this;

    async.series([

        // listen events file
        function listenFileEvents(next) {

            var tail = new Tail(self.cfg.apcupsdEventFile);
            tail.on('line', self.eventLineHandler.bind(self));
            tail.on('error', console.log);
            return next();
        },

        // receive stat event in [cfg.pollInterval] ms
        function continiousCollectStat(next) {
            function statHandler(err) {
                if (err) {
                    console.log(err);
                }
            }
            setInterval(self.getPowerstate.bind(self), self.cfg.pollInterval, statHandler);
            return next();
        }

    ], callback);
};

Device.eventLineHandler = function(line) {

    // ex.: "2014-12-08 08:38:20 +0000  Power is back. UPS running on mains."
    var eventStr = line.split(' ').slice(3).join(' ');
    if (eventStr.indexOf('Power failure') !== -1) { // power failure
        if (this.online !== false) { // event not yet fiered
            this.service.publishState(this, 'power', false);
            this.power = false;
        }
    } else if (eventStr.indexOf('Power is back') !== -1) { // power is back
        if (this.online !== true) { // event not yet fiered
            this.service.publishState(this, 'power', true);
            this.power = true;
        }
    }
};


Device.getPowerstate = function(callback) {

    var self = this;
    exec([this.cfg.apcaccessBinary], function(err, out) {
        if (err instanceof Error) {
            return callback(err);
        }

        var stat = {};
        (out || '').split('\n').forEach(function(v) {
            var arr = v.split(':');
            if (arr[1]) {
                stat[arr[0].trim()] = arr[1].trim();
            }
        });

        if (!stat.MODEL) {
            return callback(new Error('ups info not found'));
        }

        var power = stat.STATUS === 'ONLINE';
        var charge = parseInt(stat.BCHARGE, 10);
        var timeleft = parseInt(stat.TIMELEFT, 10);

        // state changed - lets fire
        if (power !== self.power && self.id) {
            self.service.publishState(self, 'power', power);
        }

        // fire 'charge changed' event
        if (charge !== self.charge && self.id) {
            self.service.publishState(self, 'charge', charge);
        }

        self.power = power;
        self.charge = charge;
        self.timeleft = timeleft;
        return callback(null, stat);

    });
};

module.exports = Device;
