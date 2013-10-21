/*
 * Router - For Subscription
 *
 * Created by Julian Jewel
 */
var app = module.parent.exports.app,
config = module.parent.exports.config;
var _ = require('underscore')
var S = require('string')
var util = require('vcommons').util;
var request = require('request');
var Log = require('vcommons').log;
var logger = Log.getLogger('RSUSBCRIBE', config.log);
var jsonpath = require("JSONPath").eval;
var retry = require('retry');

module.exports = exports = function () {
	return {
		submitRequest : function (req, res, next) {
			var path = req.params[0];
			logger.trace('Extracted path', path);
			if (_.isUndefined(path)) {
				logger.error('Error in path', path);
				res.writeHead(400, 'URL should be Ex: /assigningAuthority/identifier/health/clinicalDocuments/historicalData/medicalHistory/serviceTreatmentRecords');
				res.send();
				return;
			}
			var collection = config.path2collection[util.stripTrailingSlash(path)];
			logger.trace('Extracted collection', collection);
			if (_.isUndefined(collection)) {
				logger.error('Collection is not found', path);
				res.writeHead(400, 'Path ' + path + 'does not match a collection');
				res.send();
				return;
			}

			var ssn = jsonpath(req.body, '$..nc:PersonSSNIdentification.nc:IdentificationID');
			//var ssn = req.body['subscription:Subscription']['subscription:CommonData']['nc:Person']['nc:PersonSSNIdentification']['nc:IdentificationID'];
			logger.trace('Extracted ssn', ssn);
			if (_.isUndefined(ssn)) {
				logger.trace('Could not get SSN from message', req.body);
				logger.error('Could not get SSN from message');
				res.writeHead(400, 'SSN could not be fetched from the Subscription message');
				res.send();
				return;
			}
			if (_.isUndefined(req.params) || _.isUndefined(req.params.assigningAuthority) || !S(req.params.assigningAuthority).startsWith(config.pix.oids.ssn)) {
				logger.error('Assigning authority is wrong in the message', req.params.assigningAuthority);
				res.writeHead(400, 'Assigning Authority is invalid. Only ' + config.pix.oids.ssn + ' is supported');
				res.send();
				return;
			}
			if(S(req.params.assigningAuthority).startsWith(config.pix.oids.ssn)){
				if (_.isUndefined(req.params) || _.isUndefined(req.params.identifier) || !S(req.params.identifier).startsWith(ssn)) {
					logger.error('URL Identifier does not match with SSN in the message', req.params.identifier);
					res.writeHead(400, 'URL Identifier does not match with SSN in the message - URL:' + req.params.identifier + ' Message:' + ssn);
					res.send();
					return;
				}
				var dob = jsonpath(req.body, '$..nc:Person.nc:PersonBirthDate.nc:Date');
				logger.trace('Extracted DoB', dob);
				var firstName = jsonpath(req.body, '$..nc:Person.nc:PersonName.nc:PersonGivenName');
				logger.trace('Extracted First Name', firstName);
				var lastName = jsonpath(req.body, '$..nc:Person.nc:PersonName.nc:PersonSurName');
				logger.trace('Extracted Last Name', lastName);
				var gender = jsonpath(req.body, '$..nc:Person.nc:PersonSexCode');
				logger.trace('Extracted Gender', gender);
				
				if(_.isUndefined(dob)) {
					logger.trace('Date of birth is missing in the message', req.body);
					logger.error('Date of birth is missing in the message');
					res.writeHead(400, 'DoB is missing in the message');
					res.send();
					return;
				}
				if(_.isUndefined(firstName)) {
					logger.trace('First Name is missing in the message', req.body);
					logger.error('First Name is missing in the message');
					res.writeHead(400, 'First Name is missing in the message');
					res.send();
					return;
				}
				if(_.isUndefined(lastName)) {
					logger.trace('Last Name is missing in the message', req.body);
					logger.error('Last Name is missing in the message');
					res.writeHead(400, 'Last Name is missing in the message');
					res.send();
					return;
				}
				if(_.isUndefined(gender)) {
					logger.trace('Gender is missing in the message', req.body);
					logger.error('Gender is missing in the message');
					res.writeHead(400, 'Gender is missing in the message');
					res.send();
					return;
				}
				
			}
			var pixOperation = retry.operation(config.pix.retry);
		    pixOperation.attempt(function (currentAttempt) {
				logger.trace('Invoking PIX:' + config.pix.url + '/' + req.params.assigningAuthority + "/" + ssn, ' Attempt', currentAttempt);		    	
				request(config.pix.url + '/' + req.params.assigningAuthority + "/" + ssn, function (error, response, body) {
					
					if (pixOperation.retry(error)) {
						logger.error('Retry failed with error:', error, 'Attempt:', currentAttempt);
						return;
					}

					logger.trace('PIX Returned:' + response, ' Attempt', currentAttempt);		    	

					if (!error && response.statusCode == 200) {
						var json = JSON.parse(body);
						if (_.isUndefined(json)) {
							logger.error('Service should return atleast a value for 2.16.840.1.113883.3.275 (AUN):', json);
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
							logger.error('PIX Service should return atleast one AUN:', json);
							res.writeHead(500, 'PIX Service should return atleast one AUN');
							res.send();
							return;
						}
						if (S(aun).startsWith("UNKNOWN")) {
							logger.error('No Veteran Found:', json);
							res.writeHead(404, 'No Veteran Found');
							res.send();
							return;
						} else if (S(aun).startsWith("MULTIPLE")) {
							logger.error('Multiple Veteran Found:', json);
							res.writeHead(404, 'Multiple Veterans Found');
							res.send();
							return;
						} else {
							// Valid AUN
							// Query CRUD - http://localhost:3001/core/serviceTreatmentRecords.subscriptions?query={"subscription:Subscription.subscription:CommonData.nc:Person.nc:PersonSSNIdentification.nc:IdentificationID":"987654321"}
							var crudOperation = retry.operation(config.pix.retry);
							logger.trace('Invoking Crud:' + config.ecrud.url + '/'
								 + collection + '.subscriptions?query={"subscription:Subscription.subscription:CommonData.nc:Person.nc:PersonSSNIdentification.nc:IdentificationID":"'
								 + ssn + '"}');
							crudOperation.attempt(function (currentAttempt) {							
								logger.trace('Attempt:', currentAttempt);
								request(config.ecrud.url + '/'
									 + collection + '.subscriptions?query={"subscription:Subscription.subscription:CommonData.nc:Person.nc:PersonSSNIdentification.nc:IdentificationID":"'
									 + ssn + '"}', function (error, response, body) {
									
									if (crudOperation.retry(error)) {
										logger.error('Retry failed with error:', error, 'Attempt:', currentAttempt);
										return;
									}
									 
									logger.trace('Response:', response);
									if (!error && response.statusCode == 200) {
										var json = JSON.parse(body);
										json = json ? json : {};
										// Already Subscribed
										if (json.length > 0) {
											logger.error('Veteran already subscribed:', json);
											res.writeHead(200, 'Veteran already subscribed');
											res.send();
										} else {
											logger.trace('Adding AUN to Subscription');
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
												logger.trace('Adding Element', elementArray);
												req.body['subscription:Subscription']['subscription:CommonData']['vler:Client']['vler:ClientIdentifier'] = elementArray;
											}
											// Store Subscription
											var crudWriteOperation = retry.operation(config.ecrud.retry);
											crudWriteOperation.attempt(function (currentAttempt) {							
												logger.trace('Calling CRUD', config.ecrud.url + '/' + collection + '.subscriptions', ' Attempt', currentAttempt);
												request.post({
													url : config.ecrud.url + '/' + collection + '.subscriptions',
													headers : {
														"Content-Type" : "application/json"
													},
													method : 'POST',
													body : JSON.stringify(req.body)
												}, function (error, response, body) {
													if (crudWriteOperation.retry(error)) {
														logger.error('Retry failed with error:', error, 'Attempt:', currentAttempt);
														return;
													}
													if (!error && response.statusCode == 201) {
														logger.info('Successfully stored document into CRUD', req.body);
														res.writeHead(201);
														res.send();
														return;
													} else {
														logger.error('Error when storing document into CRUD', error);
														res.writeHead(500, 'eCRUD Error:' + error);
														res.send();
														return;
													}
												});
											});
										}
									} else {
										logger.error('Error when storing document into CRUD', error);
										res.writeHead(500, 'eCRUD seems to be down! Error:' + error);
										res.send();
										return;
									}
								});
							});
						}
					} else {
						logger.error('Subscribe is returning errors:', error);
						res.writeHead(500, 'SSN to AUN service is returning errors! Error:' + error);
						res.send();
						return;
					}
				})
			})
		}
	}
}