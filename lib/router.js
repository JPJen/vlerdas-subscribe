/*
 * Router - For LENS
 *
 * Created by Julian Jewel
 */
var app = module.parent.exports.app,
config = module.parent.exports.config;
var _ = require('underscore')
	var S = require('string')
	// For XML parsing
	UTIL = {};
UTIL.XML = require('../node_modules/vcommons/xml/js-ObjTree');
var util = require('../node_modules/vcommons/util/util');
// Globally available for conversion
var xotree = new UTIL.XML.ObjTree();
var request = require('request');

module.exports = exports = function () {
	return {
		submitRequest : function (req, res, next) {

			var path = req.params[0];
			if (_.isUndefined(path)) {
				res.writeHead(400, 'URL should be Ex: /assigningAuthority/identifier/health/clinicalDocuments/historicalData/medicalHistory/serviceTreatmentRecords');
				res.send();
				return;
			}
			var collection = config.path2collection[util.stripTrailingSlash(path)];
			if (_.isUndefined(collection)) {
				res.writeHead(400, 'Path ' + path + 'does not match a collection');
				res.send();
				return;
			}

			var ssn = req.body['subscription:Subscription']['subscription:CommonData']['nc:Person']['nc:PersonSSNIdentification']['nc:IdentificationID'];
			if (_.isUndefined(ssn)) {
				res.writeHead(400, 'SSN could not be fetched from the Subscription message');
				res.send();
				return;
			}
			if (_.isUndefined(req.params) || _.isUndefined(req.params.assigningAuthority) || !S(req.params.assigningAuthority).startsWith(config.pix.oids.ssn)) {
				res.writeHead(400, 'Assigning Authority is invalid. Only ' + config.pix.oids.ssn + ' is supported');
				res.send();
				return;
			}
			request(config.pix.url + '/' + req.params.assigningAuthority + "/" + ssn, function (error, response, body) {
				if (!error && response.statusCode == 200) {
					var json = JSON.parse(body);
					if (_.isUndefined(json)) {
						res.writeHead(500, 'Service should return atleast a value for 2.16.840.1.113883.3.275 (AUN)');
						res.send();
						return;
					}
					var aun;
					var resultArr = json['identifier:Identifier']['identifier:CommonData']['vler:Client']['vler:ClientIdentifier'];
					_.each(resultArr, function (result, index) {
						var aunAa = result['vler:AssigningAuthority'];
						if (S(aunAa).startsWith(config.pix.oids.aun)) {
							aun = result['nc:IdentificationID'];
						}
					})
					if (_.isUndefined(aun)) {
						res.writeHead(500, 'PIX Service should return atleast one AUN');
						res.send();
						return;
					}
					if (S(aun).startsWith("UNKNOWN")) {
						res.writeHead(404, 'No Veteran Found');
						res.send();
					} else if (S(aun).startsWith("MULTIPLE")) {
						res.writeHead(404, 'Multiple Veterans Found');
						res.send();
					} else {
						// Valid AUN
						// Query CRUD - http://localhost:3001/core/serviceTreatmentRecords.subscriptions?query={"subscription:Subscription.subscription:CommonData.nc:Person.nc:PersonSSNIdentification.nc:IdentificationID":"987654321"}
						request(config.ecrud.url + '/'
							 + collection + '.subscriptions?query={"subscription:Subscription.subscription:CommonData.nc:Person.nc:PersonSSNIdentification.nc:IdentificationID":"'
							 + ssn + '"}', function (error, response, body) {
							if (!error && response.statusCode == 200) {
								var json = JSON.parse(body);
								json = json ? json : {};
								// Already Subscribed
								if (json.length > 0) {
									res.writeHead(200, 'Veteran already subscribed');
									res.send();
								} else {
									// There might be a real simple way to do this :-)
									// Store AUN in the message
									// If there is no vler:Client - add vler:Client/ClientIdentifier/IdentificationID
									var newClient = req.body['subscription:Subscription']['subscription:CommonData']['vler:Client'];
									if (_.isUndefined(newClient)) {
										req.body['subscription:Subscription']['subscription:CommonData']['vler:Client'] = JSON.parse('{"vler:ClientIdentifier":{"nc:IdentificationID":"' + aun + '", "vler:AssigningAuthority":"2.16.840.1.113883.3.275" }}');
									} else {
										var newClientIdentifier = req.body['subscription:Subscription']['subscription:CommonData']['vler:Client']['vler:ClientIdentifier'];
										// Add to existing ClientIdentifier if there is one
										var jsonToAdd = JSON.parse('{"nc:IdentificationID":"' + aun + '", "vler:AssigningAuthority":"2.16.840.1.113883.3.275" }');
										var elementArray = [];
										if (!_.isUndefined(newClientIdentifier)) {
											// Append to existing if more elements exist
											if (_.isArray(newClientIdentifier)) {
												newClientIdentifier[newClientIdentifier.length] = jsonToAdd;
												elementArray = newClientIdentifier;
											} else {
												// Only one exists
												elementArray[0] = newClientIdentifier;
												elementArray[1] = jsonToAdd;
											}
										} else {
											// Add one element
											elementArray[0] = jsonToAdd;
										}
										req.body['subscription:Subscription']['subscription:CommonData']['vler:Client']['vler:ClientIdentifier'] = elementArray;
									}
									// Store Subscription
									request.post({
										url : config.ecrud.url + '/' + collection + '.subscriptions',
										headers : {
											"Content-Type" : "application/json"
										},
										method : 'POST',
										body : JSON.stringify(req.body)
									}, function (error, response, body) {
										if (!error && response.statusCode == 201) {
											res.writeHead(201);
											res.send();
											return;
										} else {
											res.writeHead(500, 'eCRUD Error:' + error);
											res.send();
											return;
										}
									});
								}
							} else {
								res.writeHead(500, 'eCRUD seems to be down! Error:' + error);
								res.send();
								return;
							}
						});
					}
				} else {
					res.writeHead(500, 'SSN to AUN service is returning errors! Error:' + error);
					res.send();
					return;
				}
			})
		}
	}
}