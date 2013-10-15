/**
 * Entry point for the RESTFul LENS Service. 
 *
 * Created by: Julian Jewel
 *
 */
var express = require('express')
var config = require('config');
var _ = require('underscore');
var bodyParser = require("../node_modules/vcommons/express/bodyParser");
// Export config, so that it can be used anywhere
module.exports.config = config;

createApp();

// Create Express App
function createApp() {
    var app = express();

    app.configure(function () {
		// Log
       app.use(express.logger());
       app.use(bodyParser({}));

        app.use(app.router);
		// Simple Access Control - TODO: Preferences & Authorizations
		// TODO: Implement Security
		// Only for development
		if(config.debug) {
			app.use(express.errorHandler({ showStack: true, dumpExceptions: true }));
		}
    });

	// Include Router
	var router = require('../lib/router')();

	// Subscribe to changes by certain domain for a person
	app.post('/lens/v1/:assigningAuthority/:identifier/*', router.submitRequest);
	
	// Listen
    app.listen(config.server.port, config.server.server, function () {
        console.log('LENS server listening on port ' + config.server.port);
    });
}

// Default exception handler
process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
});
// Ctrl-C Shutdown
process.on( 'SIGINT', function() {
  console.log( "\nShutting down from  SIGINT (Crtl-C)" )
  process.exit( )
})
// Default exception handler
process.on('exit', function (err) {
});