/**
 * Entry point for the RESTFul Subscription Service.
 *
 * Created by: Julian Jewel
 *
 */
var express = require('express')
    var config = require('config');
var _ = require('underscore');
var bodyParser = require("vcommons").bodyParser;

// Export config, so that it can be used anywhere
module.exports.config = config;

var Log = require('vcommons').log;
var logger = Log.getLogger('SUBSCRIBE', config.log);
var http = require("http");
var https = require("https");
var fs = require("fs");
var cluster = require("cluster");
var numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
    // Fork workers.
    for (var i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('online', function (worker) {
        logger.info('A worker with #' + worker.id);
    });
    cluster.on('listening', function (worker, address) {
        logger.info('A worker is now connected to ' + address.address + ':' + address.port);
    });
    cluster.on('exit', function (worker, code, signal) {
        logger.info('worker ' + worker.process.pid + ' died');
    });
} else {
    logger.info("Starting Subscription Application");
    createApp();
}

// Create Express App
function createApp() {
    var app = express();

    app.configure(function () {
        // enable web server logging; pipe those log messages through winston
        var winstonStream = {
            write : function (message, encoding) {
                logger.trace(message);
            }
        }; // Log
        app.use(bodyParser({}));
        app.use(app.router);

        if (config.debug) {
            app.use(express.errorHandler({
                    showStack : true,
                    dumpExceptions : true
                }));
        }
    });

    // Include Router
    var router = require('../lib/router')();

    app.get('/subscribe/v1/ping', function(req, res) {
    	res.writeHead(200, {'Content-Type' : 'text/plain'});
    	res.write("The VLER DAS subscribe service is up and running!\n");
    	res.end();
    	return;
    });

    // Subscribe to changes by certain domain for a person
    app.post('/lens/v1/:assigningAuthority/:identifier/*', router.submitRequest);

    // Listen
    if (!_.isUndefined(config.server) || !_.isUndefined(config.secureServer)) {
        if (!_.isUndefined(config.server)) {
            http.createServer(app).listen(config.server.port, config.server.host, function () {
                logger.info("Subscribe server listening at http://" + config.server.host + ":" + config.server.port);
            });
        }

        if (!_.isUndefined(config.secureServer)) {
            https.createServer(fixOptions(config.secureServer.options), app).listen(config.secureServer.port, config.secureServer.host, function () {
                logger.info("Subscribe server listening at https://" + config.secureServer.host + ":" + config.secureServer.port);
            });
        }
    } else {
        logger.error("Configuration must contain a server or secureServer.");
        process.exit();
    }
}

function fixOptions(configOptions) {
    var options = {};

    if (!_.isUndefined(configOptions.key) && _.isString(configOptions.key)) {
        options.key = fs.readFileSync(configOptions.key);
    }

    if (!_.isUndefined(configOptions.cert) && _.isString(configOptions.cert)) {
        options.cert = fs.readFileSync(configOptions.cert);
    }

    if (!_.isUndefined(configOptions.pfx) && _.isString(configOptions.pfx)) {
        options.pfx = fs.readFileSync(configOptions.pfx);
    }

    return options;
}
// Default exception handler
process.on('uncaughtException', function (err) {
    logger.error('Caught exception: ' + err);
    process.exit()
});
// Ctrl-C Shutdown
process.on('SIGINT', function () {
    logger.info("Shutting down from  SIGINT (Crtl-C)")
    process.exit()
})
// Default exception handler
process.on('exit', function (err) {
    logger.info('Exiting.. Error:', err);
});
