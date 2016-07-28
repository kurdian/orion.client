/*******************************************************************************
 * Copyright (c) 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env node */
var express = require('express');
var bodyParser = require('body-parser');
var domains = require('./domains');
var target = require('./target');
var request = require('request');
var tasks = require('../tasks');
var util = require('../git/util');

module.exports.router = function() {

	return express.Router()
		.use(bodyParser.json())
		.get('*', getroutes);

	function getroutes(req, res) {
		var task = new tasks.Task(res, false, false, 0, false);
		var targetRequest = JSON.parse(req.query.Target);
		var RouteJsonRequest = req.query.Route && JSON.parse(req.query.Route);
		var globalCheck = req.query.GlobalCheck;
		target.computeTarget(req.user.username, targetRequest, task)
	 	.then(function(appTarget){
	 		var waitForGetRouteJson;
			if (RouteJsonRequest) {
				if (globalCheck && globalCheck === "true") {
					// TODO need to test the following two cases.
					waitForGetRouteJson = checkRouteRequest(appTarget, req.user.username,targetRequest, RouteJsonRequest.DomainName, RouteJsonRequest.Host);
				}
				waitForGetRouteJson = getRouteRequest(appTarget, req.user.username, targetRequest, RouteJsonRequest.DomainName, RouteJsonRequest.Host);
			}
			waitForGetRouteJson = getRouteRequest(appTarget, req.user.username, targetRequest, false);
			return Promise.resolve(waitForGetRouteJson)
				.then(function(routes) {
					var resp = {
						"Routes": routes
					};
					task.done({
						HttpCode: 200,
						Code: 0,
						DetailedMessage: "OK",
						JsonData: resp,
						Message: "OK",
						Severity: "Ok"
					});
				});
		 	});
	}
	function checkRouteRequest(appTarget, userId, targetRequest, domainName, host) {
		return domains.getCFdomains(appTarget, userId, targetRequest.Url, targetRequest.Org, domainName)
		.then(function(domains) {
			return target.cfRequest('GET', userId, null, targetRequest.Url + '/v2/routes/reserved/domain/' + domains[0].metadata.guid + '/host/' + host);
		});
	}
	function getRouteRequest(appTarget, userId, targetRequest) {
		var routesArray = [];
		if (arguments.length === 5) {
			var domainName = arguments[3];
			var host = arguments[4];
		} else if (arguments.length === 5) {
			var orphaned = arguments[3];
		}
		return new Promise(function(fulfill) {
			if (domainName && host) {
				return domains.getCFdomains(appTarget, userId, targetRequest.Url, targetRequest.Org, domainName)
					.then(function(domains) {
						var domainGuid = domains[0].metadata.guid;
						return target.cfRequest('GET', userId, null, targetRequest.Url + '/v2/routes',
							{'inline-relations-depth': '1',	'q': util.encodeURIComponent('host:' + host + ';domain_guid' + domainGuid)})
						.then(function(result){
							fulfill(result);
						});
					});
			}
			return target.cfRequest('GET', userId, null, targetRequest.Url + appTarget.Space.entity.routes_url, {'inline-relations-depth': '1'}
			).then(function(result){
				fulfill(result);
			});
		})
		.then(function(result) {
			var routesResources = result.resources;
			for (var k = 0; k < routesResources.length; k++) {
				if (!orphaned || routesResources.entity.apps.length === 0) {
					var appArray = [];
					var apps = routesResources[k].entity.apps;
					for (var j = 0; j < apps.length; j++) {
						appArray.push({
							"Guid": apps[j].metadata.guid,
							"Name": apps[j].entity.name,
							"State": apps[j].entity.state,
							"Type": "App"
						});
					}
					var routeJson = {
						'Apps': appArray,
						'DomainName': routesResources[k].entity.domain.entity.name,
						'Guid': routesResources[k].metadata.guid,
						'Host': routesResources[k].entity.host,
						'Type': 'Route'
					};
					routesArray.push(routeJson);
				}
			}
			return routesArray;
		});
	}
};