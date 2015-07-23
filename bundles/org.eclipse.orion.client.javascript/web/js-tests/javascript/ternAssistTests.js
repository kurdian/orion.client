/*******************************************************************************
 * @license
 * Copyright (c) 2015 IBM Corporation, Inc. and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html).
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 ******************************************************************************/
/*eslint-env amd, mocha, node, browser*/
/*global doctrine*/
/* eslint-disable missing-nls */
define([
'javascript/contentAssist/ternAssist',
'javascript/astManager',
'esprima',
'chai/chai',
'orion/Deferred',
'mocha/mocha', //must stay at the end, not a module
'doctrine' //must stay at the end, does not export a module 
], function(TernAssist, ASTManager, Esprima, chai, Deferred) {
	var assert = chai.assert;

	var state;
	var ternworker = new Worker('../../javascript/plugins/ternWorker.js');
	ternworker.onmessage = function(ev) {
		if(typeof(ev.data) === 'object') {
			var _d = ev.data;
			if(_d.request === 'read') {
				if(fileMap && _d.args.file.logical) {
					var _f = fileMap[_d.args.file.logical];
					if(_f) {
						ternworker.postMessage({request: 'read', args: {contents: state.buffer, file: state.file, logical: _d.args.file.logical}});
					} else {
						ternworker.postMessage({request: 'read', args: {logical: _d.args.file.logical, error: 'could not read test file'}});
					}
				} else {
					ternworker.postMessage({request: 'read', args: {contents: state.buffer, file: state.file}});
				}
			} else if(typeof(_d.request) === 'string') {
				//don't process requests other than the ones we want
				return;
			} else if(_d.error) {
				var err = _d.error;
				if(err instanceof Error) {
					state.callback(err);
				} else if(typeof(err) === 'string') {
					if(typeof(_d.message) === 'string') {
						state.callback(new Error(err+": "+_d.message));
					} else {
						//wrap it
						state.callback(new Error(err));
					}
				} else if(err && typeof(err.message) === 'string') {
					state.callback(new Error(err.message));
				}
			}
			else {
				state.callback(new Error('Got message I don\'t know'));
			}
		} else if(typeof(ev.data) === 'string' && ev.data === 'server_ready' && state.warmup) {
			delete state.warmup;
			state.callback();
		}
	};
	ternworker.onerror = function(err) {
		if(err instanceof Error) {
			state.callback(err);
		} else if(typeof(err) === 'string') {
			//wrap it
			state.callback(new Error(err));
		} else if(err && typeof(err.message) === 'string') {
			state.callback(new Error(err.message));
		}
	};
	ternworker.postMessage('tests_ready');
	var envs = Object.create(null);
	var astManager = new ASTManager.ASTManager(Esprima);
	var ternAssist = new TernAssist.TernContentAssist(astManager, ternworker, function() {
			return new Deferred().resolve(envs);
		});
		
	var fileMap = Object.create(null);
	/**
	 * @description Sets up the test
	 * @param {Object} options The options the set up with
	 * @returns {Object} The object with the initialized values
	 */
	function setup(options) {
		state = Object.create(null);
		fileMap = Object.create(null);
		var buffer = state.buffer = typeof(options.buffer) === 'undefined' ? '' : options.buffer,
		    prefix = state.prefix = typeof(options.prefix) === 'undefined' ? '' : options.prefix,
		    offset = state.offset = typeof(options.offset) === 'undefined' ? 0 : options.offset,
		    line = state.line = typeof(options.line) === 'undefined' ? '' : options.line,
		    keywords = typeof(options.keywords) === 'undefined' ? false : options.keywords,
		    templates = typeof(options.templates) === 'undefined' ? false : options.templates,
		    contentType = options.contenttype ? options.contenttype : 'application/javascript',
			file = state.file = 'tern_content_assist_test_script.js';
			assert(options.callback, 'You must provide a test callback for worker-based tests');
			state.callback = options.callback;
			ternworker.postMessage({request: 'delfile', args:{file: file}});
		envs = typeof(options.env) === 'object' ? options.env : Object.create(null);
		var editorContext = {
			/*override*/
			getText: function() {
				return new Deferred().resolve(buffer);
			},
			
			getFileMetadata: function() {
			    var o = Object.create(null);
			    o.contentType = Object.create(null);
			    o.contentType.id = contentType;
			    o.location = file;
			    return new Deferred().resolve(o);
			}
		};
		astManager.onModelChanging({file: {location: file}});
		var params = {offset: offset, prefix : prefix, keywords: keywords, template: templates, line: line};
		return {
			editorContext: editorContext,
			params: params
		};
	}
	
	/**
	 * @description Pretty-prints the given array of proposal objects
	 * @param {Array} expectedProposals The array of proposals
	 * @returns {String} The pretty-printed proposals
	 */
	function stringifyExpected(expectedProposals) {
		var text = "";
		for (var i = 0; i < expectedProposals.length; i++)  {
			text += expectedProposals[i][0] + " : " + expectedProposals[i][1] + "\n";
		}
		return text;
	}
	
	/**
	 * @description Pretty-prints the given array of proposal objects
	 * @param {Array} expectedProposals The array of proposals
	 * @returns {String} The pretty-printed proposals
	 */
	function stringifyActual(actualProposals) {
		var text = "";
		for (var i = 0; i < actualProposals.length; i++) {
			if (actualProposals[i].name) {
				text += actualProposals[i].proposal + " : " + actualProposals[i].name + actualProposals[i].description + "\n"; //$NON-NLS-1$ //$NON-NLS-0$
			} else {
				text += actualProposals[i].proposal + " : " + actualProposals[i].description + "\n"; //$NON-NLS-1$ //$NON-NLS-0$
			}
		}
		return text;
	}

	/**
	 * @description Checks the proposals returned from the given proposal promise against
	 * the array of given proposals
	 * @param {Object} options The options to test with
	 * @param {Array} expectedProposals The array of expected proposal objects
	 */
	function testProposals(options, expectedProposals) {
		var _p = setup(options);
		assert(_p, 'setup() should have completed normally');
		ternAssist.computeContentAssist(_p.editorContext, _p.params).then(function (actualProposals) {
			try {
				assert.equal(actualProposals.length, expectedProposals.length,
					"Wrong number of proposals.  Expected:\n" + stringifyExpected(expectedProposals) +"\nActual:\n" + stringifyActual(actualProposals));
				for (var i = 0; i < actualProposals.length; i++) {
				    var ap = actualProposals[i];
				    var ep = expectedProposals[i];
					var text = ep[0];
					var description = ep[1];
					assert.equal(ap.proposal, text, "Invalid proposal text"); //$NON-NLS-0$
					if (description) {
						if (ap.name) {
							assert.equal(ap.name + ap.description, description, "Invalid proposal description"); //$NON-NLS-0$
						} else {
							assert.equal(ap.description, description, "Invalid proposal description"); //$NON-NLS-0$
						}
					}
					if(expectedProposals[i].length === 3 && !ap.unselectable /*headers have no hover*/) {
					    //check for doc hover
					    assert(ap.hover, 'There should be a hover entry for the proposal');
					    assert(ap.hover.indexOf(ep[2]) === 0, "The doc should have started with the given value"); 
					}
				}
				state.callback();
			}
			catch(err) {
				state.callback(err);
			}
		}, function (error) {
			state.callback(error);
		});
	}

	before('Message the server for warm up', function(callback) {
		this.timeout(10000);
		var options = {
			buffer: "xx",
			prefix: "xx",
			offset: 1,
			callback: callback
		};
		var _p = setup(options);
		state.warmup = true;
		ternAssist.computeContentAssist(_p.editorContext, _p.params).then(/* @callback */ function (actualProposals) {
			//do noting, warm up
		});
	});

	describe('Tern Content Assist Tests', function() {
		this.timeout(10000);
		describe('Complete Syntax', function() {
			it("test no dupe 1", function(done) {
				var options = {
					buffer: "x",
					prefix: "x",
					offset: 1,
					callback: done
				};
				testProposals(options, []);
			});
			it("test no dupe 2", function(done) {
				var options = {
					buffer: "var coo = 9; var other = function(coo) { c }",
					prefix: "c",
					offset: 42,
					callback: done
				};
				testProposals(options, [
					["coo", "coo : any"]
				]);
			});
		
			it("test no dupe 3", function(done) {
				var options = {
					buffer: "var coo = { }; var other = function(coo) { coo = 9;\nc }",
					prefix: "c",
					offset: 53,
					callback: done
				};
				testProposals(options, [
					["coo", "coo : number"]
				]);
			});
			it("test full file inferecing 1", function(done) {
				var options = {
					buffer: "x;\n var x = 0;", 
					prefix: "x", 
					offset: 1,
					callback: done};
				return testProposals(options, [
					["x", "x : number"]
				]);
			});
			it("test full file inferecing 2", function(done) {
				var options = {
					buffer: "function a() { x; }\n var x = 0;", 
					prefix: "x", 
					offset: 16,
					callback: done};
				return testProposals(options, [
					["x", "x : number"]
				]);
			});
			it("test full file inferecing 3", function(done) {
				var options = {
					buffer: "function a() { var y = x; y}\n var x = 0;", 
					prefix: "y", 
					offset: 27,
					callback: done};
				return testProposals(options, [
					["y", "y : number"]
				]);
			});
			it("test full file inferecing 4", function(done) {
				var options = {
					buffer: "function a() { var y = x.fff; y}\n var x = { fff : 0 };", 
					prefix: "y", 
					offset: 31,
					callback: done};
				return testProposals(options, [
					["y", "y : number"]
				]);
			});
			it("test full file inferecing 5", function(done) {
				var options = {
					buffer: "function a() { var y = x.fff; y}\n var x = {};\n x.fff = 8;", 
					prefix: "y", 
					offset: 31,
					callback: done};
				return testProposals(options, [
					["y", "y : number"]
				]);
			});
			it("test full file inferecing 6", function(done) {
				var options = {
					buffer: "function a() { x.fff = ''; var y = x.fff; y}\n" +
					"var x = {};\n" +
					"x.fff = 8;",
					prefix: "y", 
					offset: 43,
					callback: done};
				return testProposals(options, [
					["y", "y : string|number"]
				]);
			});
			it("test full file inferecing 7", function(done) {
				var options = {
					buffer: "function a() { x.fff = ''; var y = x(); y}\n" +
					"var x = function() { return 8; }", 
					prefix: "y", 
					offset: 41,
					callback: done};
				return testProposals(options, [
					["y", "y : number"]
				]);
			});
			it("test full file inferecing 8", function(done) {
				var options = {
					buffer: "function a() { x.fff = ''; var y = z(); y}\n" +
					"var x = function() { return 8; }, z = x", 
					prefix: "y", 
					offset: 41,
					callback: done};
				return testProposals(options, [
					["y", "y : number"]
				]);
			});
		
			it("test full file inferecing 9", function(done) {
				var options = {
					buffer: "function a() {\n function b() {\n x.fff = '';\n }\n x.f\n}\n var x = {};", 
					prefix: "f", 
					offset: 51,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
			it("test full file inferecing 10", function(done) {
				var options = {
					buffer: "function a() {\n function b() {\n x.fff = '';\n }\n var y = x;\n y.f\n }\n var x = {};", 
					prefix: "f", 
					offset: 63,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 11a", function(done) {
				var options = {
					buffer: "var x = {};\n function a() {\n var y = x;\n y.f\n function b() {\n x.fff = '';\n}\n}", 
					prefix: "f", 
					offset: 44,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 11", function(done) {
				var options = {
					buffer: "function a() {\n var y = x;\n y.f\n function b() {\n x.fff = '';\n }\n }\n var x = {};", 
					prefix: "f", 
					offset: 31,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 12", function(done) {
				var options = {
					buffer: "function a() {\n var y = x;\n y.f\n x.fff = '';\n }\n var x = {};", 
					prefix: "f", 
					offset: 31,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 13", function(done) {
				var options = {
					buffer: "function b() {\n x.fff = '';\n }\n function a() {\n var y = x;\n y.f\n }\n var x = {};", 
					prefix: "f", 
					offset: 63,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 14", function(done) {
				var options = {
					buffer: "function a() {\n  var y = x;\n y.f\n }\n function b() {\n x.fff = '';\n }\n var x = {};", 
					prefix: "f", 
					offset: 32,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 15", function(done) {
				var options = {
					buffer: "function b() {\n x.fff = '';\n }\n function a() {\n x.f\n }\n var x = {};", 
					prefix: "f", 
					offset: 51,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			// should still find the fff property here evem though it
			// is defined after and in another funxtion
			it("test full file inferecing 16", function(done) {
				var options = {
					buffer: "function a() {\n x.f\n }\n function b() {\n x.fff = '';\n }\n var x = {};", 
					prefix: "f", 
					offset: 19,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
			it("test full file inferecing 17", function(done) {
				var options = {
					buffer: "function a() {\n x.f\n function b() {\n x.fff = '';\n }\n }\n var x = {};", 
					prefix: "f", 
					offset: 19,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 18", function(done) {
				var options = {
					buffer: "function a() {\n x.fff = '';\n function b() {\n x.f\n }\n }\n var x = {};", 
					prefix: "f", 
					offset: 48,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 19", function(done) {
				var options = {
					buffer: "function a() {\n function b() {\n x.f\n }\n x.fff = '';\n }\n var x = {};", 
					prefix: "f", 
					offset: 35,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			// don't find anything because assignment is in same scope, but after
			it("test full file inferecing 20", function(done) {
				var options = {
					buffer: "x.\n" +
					"var x = {};\n" +
					"x.fff = '';", 
					prefix: "f", 
					offset: 2,
					callback: done};
				return testProposals(options, [
					['fff', 'fff : string']
				]);
			});
		
			it("test full file inferecing 21", function(done) {
				var options = {
					buffer: "function a() {\n x.fff = '';\n }\n x.\n var x = {}; ", 
					prefix: "f", 
					offset: 34,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 22", function(done) {
				var options = {
					buffer: "x.\n" +
					"function a() {\n" +
					"x.fff = '';\n" +
					"}\n" +
					"var x = {}; ", 
					prefix: "f", 
					offset: 2,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			it("test full file inferecing 26", function(done) {
				var options = {
					buffer: "function a() {\n function b() {\n var fff = x();\n f;\n }\n }\n function x() { return ''; }", 
					prefix: "f", 
					offset: 49,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"],
				]);
			});
		
			// Not inferencing String because function decl comes after reference in same scope
			it("test full file inferecing 27", function(done) {
				var options = {
					buffer: "var fff = x();\n f;\n function x() { return ''; }", 
					prefix: "f", 
					offset: 17,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			// Not gonna work because of recursive
			it("test full file inferecing 28", function(done) {
				var options = {
					buffer: "function x() {\n var fff = x();\n f;\n return ''; }", 
					prefix: "f", 
					offset: 33,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"],
				]);
			});
		
			it("test full file inferecing 29", function(done) {
				var options = {
					buffer: "function a() {\n function b() {\n var fff = x();\n f;\n }\n }\n var x = function() { return ''; }", 
					prefix: "f", 
					offset: 49,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"],
				]);
			});
		
			// Not working because function decl comes after reference in same scope
			it("test full file inferecing 30", function(done) {
				var options = {
					buffer: "var fff = x();\n f;\n var x = function() { return ''; }", 
					prefix: "f", 
					offset: 17,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"]
				]);
			});
		
			// Not gonna work because of recursive
			it("test full file inferecing 31", function(done) {
				var options = {
					buffer: "var x = function() { var fff = x();\nf;return ''; }", 
					prefix: "f", 
					offset: 37,
					callback: done};
				return testProposals(options, [
					["fff", "fff : string"],
				]);
			});
		
			it("test full file inferecing 32", function(done) {
				var options = {
					buffer: "x\n function x() { return ''; }", 
					prefix: "x", 
					offset: 1,
					callback: done};
				return testProposals(options, [
					["x()", "x() : string"]
				]);
			});
		
			it("test full file inferecing 33", function(done) {
				var options = {
					buffer: "var xxx = {\n aaa: '',\n bbb: this.a\n};", 
					prefix: "a", 
					offset: 34,
					callback: done};
				return testProposals(options, [
					//TODO bug in Tern? ["aaa", "aaa : string"]
				]);
			});
		
			it("test full file inferecing 34", function(done) {
				var options = {
					buffer: "var xxx = {\n" +
					"	bbb: this.a,\n" +
					"	aaa: ''\n" +
					"};", 
					prefix: "a", 
					offset: 24,
					callback: done};
				return testProposals(options, [
					//TODO bug in Tern? ["aaa", "aaa : string"]
				]);
			});
			it("test property read before", function(done) {
				var options = {
					buffer: "var xxx; xxx.lll++; xxx.ll", 
					prefix: "ll",
					offset: 26,
					callback: done};
				return testProposals(options, [
					["lll", "lll"]
				]);
			});
		
			it("test property read after", function(done) {
				var options = {
					buffer: "var xxx;\n" +
					"xxx.ll;\n" +
					"xxx.lll++;", 
					prefix: "ll", 
					offset: 15,
					callback: done};
				return testProposals(options, [
					["lll", "lll"]
				]);
			});
		
			it("test property read global before", function(done) {
				var options = {
					buffer: "lll++; ll", 
					prefix: "ll",
					offset: 9,
					callback: done};
				return testProposals(options, [
					//TODO ["lll", "lll"]
				]);
			});
		
			it("test property read global after", function(done) {
				var options = {
					buffer: "ll; lll++;", 
					prefix: "ll", 
					offset: 2,
					callback: done};
				return testProposals(options, [
					//TODO ["lll", "lll"]
				]);
			});
			
			it("test array parameterization 1", function(done) {
				var options = {
					buffer: "var x = [1]; x[foo].toFi", 
					prefix: "toFi",
					offset: 24,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 2", function(done) {
				var options = {
					buffer: "var x = [1]; x[0].toFi", 
					prefix: "toFi",
					offset: 22,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 3", function(done) {
				var options = {
					buffer: "var x = [1]; x['foo'].toFi", 
					prefix: "toFi",
					offset: 26,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 4", function(done) {
				var options = {
					buffer: "([1, 0])[0].toFi", 
					prefix: "toFi",
					offset: 16,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 5", function(done) {
				var options = {
					buffer: "var x = [[1]]; x[0][0].toFi", 
					prefix: "toFi",
					offset: 27,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 6", function(done) {
				var options = {
					buffer: "var x = [{}];x[0].a = 8; x[0].a.toFi", 
					prefix: "toFi",
					offset: 36,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 7", function(done) {
				var options = {
					buffer: "var a = {a : 8}; var x = [a]; x[0].a.toFi", 
					prefix: "toFi",
					offset: 41,
					callback: done};
					// may not work because a string
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 8", function(done) {
				var options = {
					buffer: "var x = [[1]]; x = x[0]; x[0].toFi", 
					prefix: "toFi",
					offset: 34,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 9", function(done) {
				var options = {
					buffer: "var x = []; x[9] = 0; x[0].toFi", 
					prefix: "toFi",
					offset: 31,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 10", function(done) {
				var options = {
					buffer: "var x = []; x[9] = ''; x[9] = 0; x[0].toFi", 
					prefix: "toFi",
					offset: 42,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 11", function(done) {
				var options = {
					buffer: "var x = (function() { return [0]; })(); x[9] = 0; x[0].toFi", 
					prefix: "toFi",
					offset: 59,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test array parameterization 12", function(done) {
				var options = {
					buffer: "var x = ['','','']; x[9] = 0; x[0].toFi", 
					prefix: "toFi",
					offset: 39,
					callback: done};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
		
			// https://github.com/scripted-editor/scripted/issues/65
			it("test case insensitive ordering 1", function(done) {
				var options = {
					buffer: "var xXXX = 8; var xXYZ = 8; var xxxx = 8; var xxyz = 8; x", 
					prefix: "x",
					offset: 57,
					callback: done};
				return testProposals(options, [
					["xXXX", "xXXX : number"],
					["xXYZ", "xXYZ : number"],
					["xxxx", "xxxx : number"],
					["xxyz", "xxyz : number"]
				]);
			});
			// https://github.com/scripted-editor/scripted/issues/65
			it("test case insensitive ordering 2", function(done) {
				var options = {
					buffer: "var xXYZ = 8;var xxxx = 8; var xXXX = 8; var xxyz = 8; x", 
					prefix: "x",
					offset: 56,
					callback: done};
				return testProposals(options, [
					["xXXX", "xXXX : number"],
					["xXYZ", "xXYZ : number"],
					["xxxx", "xxxx : number"],
					["xxyz", "xxyz : number"]
				]);
			});
		});
		describe('Incomplete Syntax', function() {
			/**
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=465334
			 */
			it("test shorthand if 1", function(done) {
				var options = {
					buffer: "var foo = {}; var bar = foo ? f",
					prefix: "f",
					offset: 31,
					callback: done
				};
				testProposals(options, [
					["foo", "foo : foo"]
				]);
			});
			/**
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=465334
			 */
			it("test shorthand if 2", function(done) {
				var options = {
					buffer: "var foo = {}; var bar = foo && !false && foo.baz || foo.err ? foo : u",
					prefix: "u",
					offset: 69,
					callback: done
				};
				testProposals(options, [
					["", "ecma5", ""],
					["undefined", "undefined : any"]
				]);
			});
		});
		describe('Simple File Completions', function() {
			it("empty 1", function(done) {
				var options = {
					buffer: "x",
					prefix: "x",
					offset: 1,
					callback: done
				};
				testProposals(options, []);
			});
			it("empty 2", function(done) {
				var options = {
					buffer: "",
					offset: 0,
					callback: done
				};
				return testProposals(options, [
					['exports', 'exports : exports'],
					['module', 'module : Module'],
 					['', 'ecma5'],
					['Array(size)', ''],
					['Boolean(value)', 'Boolean(value) : bool'],
					['Date(ms)', 'Date(ms)'],
					['Error(message)', ''],
					['EvalError(message)', ''],
					['Function(body)', 'Function(body) : fn()'],
					['Number(value)', 'Number(value) : number'],
					['Object()', 'Object()'],
					['RangeError(message)', ''],
					['ReferenceError(message)', ''],
					['RegExp(source, flags?)', ''],
					['String(value)', 'String(value) : string'],
					['SyntaxError(message)', ''],
					['TypeError(message)', ''],
					['URIError(message)', ''],
					['decodeURI(uri)', 'decodeURI(uri) : string'],
					['decodeURIComponent(uri)', 'decodeURIComponent(uri) : string'],
					['encodeURI(uri)', 'encodeURI(uri) : string'],
					['encodeURIComponent(uri)', 'encodeURIComponent(uri) : string'],
					['eval(code)', 'eval(code)'],
					['isFinite(value)', 'isFinite(value) : bool'],
					['isNaN(value)', 'isNaN(value) : bool'],
					['parseFloat(string)', 'parseFloat(string) : number'],
					['parseInt(string, radix?)', 'parseInt(string, radix?) : number'],
					['Infinity', 'Infinity : number'],
					['JSON', 'JSON : JSON'],
					['Math', 'Math : Math'],
					['NaN', 'NaN : number'],
					['undefined', 'undefined : any'],
					['', 'ecma6'],
					['ArrayBuffer(length)', ''],
					['DataView(buffer, byteOffset?, byteLength?)', ''],
					['Float32Array(length)', ''],
					['Float64Array(length)', ''],
					['Int16Array(length)', ''],
					['Int32Array(length)', ''],
					['Int8Array(length)', ''],
					['Map(iterable?)', ''],
					['Promise(executor)', ''],
					['Proxy(target, handler)', ''],
					['Set(iterable)', ''],
					['Symbol(description?)', ''],
					['TypedArray(length)', ''],
					['Uint16Array()', ''],
					['Uint32Array()', ''],
					['Uint8Array()', ''],
					['Uint8ClampedArray()', ''],
					['WeakMap(iterable)', ''],
					['WeakSet(iterable)', '']
				]);
			});
			it("test Single Var Content Assist", function(done) {
				var options = {
					buffer: "var zzz = 9;\n",
					prefix: '',
					offset: 13,
					callback: done
				};
				return testProposals(options, [
					['exports', 'exports : exports'],
					['module', 'module : Module'],
					["zzz", "zzz : number"],
 					['', 'ecma5'],
					['Array(size)', ''],
					['Boolean(value)', 'Boolean(value) : bool'],
					['Date(ms)', 'Date(ms)'],
					['Error(message)', ''],
					['EvalError(message)', ''],
					['Function(body)', 'Function(body) : fn()'],
					['Number(value)', 'Number(value) : number'],
					['Object()', 'Object()'],
					['RangeError(message)', ''],
					['ReferenceError(message)', ''],
					['RegExp(source, flags?)', ''],
					['String(value)', 'String(value) : string'],
					['SyntaxError(message)', ''],
					['TypeError(message)', ''],
					['URIError(message)', ''],
					['decodeURI(uri)', 'decodeURI(uri) : string'],
					['decodeURIComponent(uri)', 'decodeURIComponent(uri) : string'],
					['encodeURI(uri)', 'encodeURI(uri) : string'],
					['encodeURIComponent(uri)', 'encodeURIComponent(uri) : string'],
					['eval(code)', 'eval(code)'],
					['isFinite(value)', 'isFinite(value) : bool'],
					['isNaN(value)', 'isNaN(value) : bool'],
					['parseFloat(string)', 'parseFloat(string) : number'],
					['parseInt(string, radix?)', 'parseInt(string, radix?) : number'],
					['Infinity', 'Infinity : number'],
					['JSON', 'JSON : JSON'],
					['Math', 'Math : Math'],
					['NaN', 'NaN : number'],
					['undefined', 'undefined : any'],
					['', 'ecma6'],
					['ArrayBuffer(length)', ''],
					['DataView(buffer, byteOffset?, byteLength?)', ''],
					['Float32Array(length)', ''],
					['Float64Array(length)', ''],
					['Int16Array(length)', ''],
					['Int32Array(length)', ''],
					['Int8Array(length)', ''],
					['Map(iterable?)', ''],
					['Promise(executor)', ''],
					['Proxy(target, handler)', ''],
					['Set(iterable)', ''],
					['Symbol(description?)', ''],
					['TypedArray(length)', ''],
					['Uint16Array()', ''],
					['Uint32Array()', ''],
					['Uint8Array()', ''],
					['Uint8ClampedArray()', ''],
					['WeakMap(iterable)', ''],
					['WeakSet(iterable)', '']
				]);
			});
			it("test Single Var Content Assist 2", function(done) {
				var options = {
					buffer: "var zzz;\n",
					prefix: '',
					offset: 9,
					callback: done
				};
				return testProposals(options, [
					['exports', 'exports : exports'],
					['module', 'module : Module'],
					["zzz", "zzz : any"],
 					['', 'ecma5'],
					['Array(size)', ''],
					['Boolean(value)', 'Boolean(value) : bool'],
					['Date(ms)', 'Date(ms)'],
					['Error(message)', ''],
					['EvalError(message)', ''],
					['Function(body)', 'Function(body) : fn()'],
					['Number(value)', 'Number(value) : number'],
					['Object()', 'Object()'],
					['RangeError(message)', ''],
					['ReferenceError(message)', ''],
					['RegExp(source, flags?)', ''],
					['String(value)', 'String(value) : string'],
					['SyntaxError(message)', ''],
					['TypeError(message)', ''],
					['URIError(message)', ''],
					['decodeURI(uri)', 'decodeURI(uri) : string'],
					['decodeURIComponent(uri)', 'decodeURIComponent(uri) : string'],
					['encodeURI(uri)', 'encodeURI(uri) : string'],
					['encodeURIComponent(uri)', 'encodeURIComponent(uri) : string'],
					['eval(code)', 'eval(code)'],
					['isFinite(value)', 'isFinite(value) : bool'],
					['isNaN(value)', 'isNaN(value) : bool'],
					['parseFloat(string)', 'parseFloat(string) : number'],
					['parseInt(string, radix?)', 'parseInt(string, radix?) : number'],
					['Infinity', 'Infinity : number'],
					['JSON', 'JSON : JSON'],
					['Math', 'Math : Math'],
					['NaN', 'NaN : number'],
					['undefined', 'undefined : any'],
					['', 'ecma6'],
					['ArrayBuffer(length)', ''],
					['DataView(buffer, byteOffset?, byteLength?)', ''],
					['Float32Array(length)', ''],
					['Float64Array(length)', ''],
					['Int16Array(length)', ''],
					['Int32Array(length)', ''],
					['Int8Array(length)', ''],
					['Map(iterable?)', ''],
					['Promise(executor)', ''],
					['Proxy(target, handler)', ''],
					['Set(iterable)', ''],
					['Symbol(description?)', ''],
					['TypedArray(length)', ''],
					['Uint16Array()', ''],
					['Uint32Array()', ''],
					['Uint8Array()', ''],
					['Uint8ClampedArray()', ''],
					['WeakMap(iterable)', ''],
					['WeakSet(iterable)', '']
				]);
			});
			it("test multi var content assist 1", function(done) {
				var options = {
					buffer: "var zzz;\nvar xxx, yyy;\n",
					prefix: '',
					offset: 23,
					callback: done
				};
				return testProposals(options, [
					['exports', 'exports : exports'],
					['module', 'module : Module'],
					["xxx", "xxx : any"],
					["yyy", "yyy : any"],
					["zzz", "zzz : any"],
 					['', 'ecma5'],
					['Array(size)', ''],
					['Boolean(value)', 'Boolean(value) : bool'],
					['Date(ms)', 'Date(ms)'],
					['Error(message)', ''],
					['EvalError(message)', ''],
					['Function(body)', 'Function(body) : fn()'],
					['Number(value)', 'Number(value) : number'],
					['Object()', 'Object()'],
					['RangeError(message)', ''],
					['ReferenceError(message)', ''],
					['RegExp(source, flags?)', ''],
					['String(value)', 'String(value) : string'],
					['SyntaxError(message)', ''],
					['TypeError(message)', ''],
					['URIError(message)', ''],
					['decodeURI(uri)', 'decodeURI(uri) : string'],
					['decodeURIComponent(uri)', 'decodeURIComponent(uri) : string'],
					['encodeURI(uri)', 'encodeURI(uri) : string'],
					['encodeURIComponent(uri)', 'encodeURIComponent(uri) : string'],
					['eval(code)', 'eval(code)'],
					['isFinite(value)', 'isFinite(value) : bool'],
					['isNaN(value)', 'isNaN(value) : bool'],
					['parseFloat(string)', 'parseFloat(string) : number'],
					['parseInt(string, radix?)', 'parseInt(string, radix?) : number'],
					['Infinity', 'Infinity : number'],
					['JSON', 'JSON : JSON'],
					['Math', 'Math : Math'],
					['NaN', 'NaN : number'],
					['undefined', 'undefined : any'],
					['', 'ecma6'],
					['ArrayBuffer(length)', ''],
					['DataView(buffer, byteOffset?, byteLength?)', ''],
					['Float32Array(length)', ''],
					['Float64Array(length)', ''],
					['Int16Array(length)', ''],
					['Int32Array(length)', ''],
					['Int8Array(length)', ''],
					['Map(iterable?)', ''],
					['Promise(executor)', ''],
					['Proxy(target, handler)', ''],
					['Set(iterable)', ''],
					['Symbol(description?)', ''],
					['TypedArray(length)', ''],
					['Uint16Array()', ''],
					['Uint32Array()', ''],
					['Uint8Array()', ''],
					['Uint8ClampedArray()', ''],
					['WeakMap(iterable)', ''],
					['WeakSet(iterable)', '']
				]);
			});
			it("test multi var content assist 2", function(done) {
				var options = {
					buffer: "var zzz;\nvar zxxx, xxx, yyy;\nz",
					prefix: 'z',
					offset: 29,
					callback: done
				};
				return testProposals(options, [
					["zxxx", "zxxx : any"],
					["zzz", "zzz : any"]
				]);
			});
			it("test single function content assist", function(done) {
				var options = {
					buffer: "function fun(a, b, c) {}\n",
					prefix: '',
					offset: 25,
					callback: done
				};
				return testProposals(options, [
					['fun(a, b, c)', ''],
					['exports', 'exports : exports'],
					['module', 'module : Module'],
 					['', 'ecma5'],
					['Array(size)', ''],
					['Boolean(value)', 'Boolean(value) : bool'],
					['Date(ms)', 'Date(ms)'],
					['Error(message)', ''],
					['EvalError(message)', ''],
					['Function(body)', 'Function(body) : fn()'],
					['Number(value)', 'Number(value) : number'],
					['Object()', 'Object()'],
					['RangeError(message)', ''],
					['ReferenceError(message)', ''],
					['RegExp(source, flags?)', ''],
					['String(value)', 'String(value) : string'],
					['SyntaxError(message)', ''],
					['TypeError(message)', ''],
					['URIError(message)', ''],
					['decodeURI(uri)', 'decodeURI(uri) : string'],
					['decodeURIComponent(uri)', 'decodeURIComponent(uri) : string'],
					['encodeURI(uri)', 'encodeURI(uri) : string'],
					['encodeURIComponent(uri)', 'encodeURIComponent(uri) : string'],
					['eval(code)', 'eval(code)'],
					['isFinite(value)', 'isFinite(value) : bool'],
					['isNaN(value)', 'isNaN(value) : bool'],
					['parseFloat(string)', 'parseFloat(string) : number'],
					['parseInt(string, radix?)', 'parseInt(string, radix?) : number'],
					['Infinity', 'Infinity : number'],
					['JSON', 'JSON : JSON'],
					['Math', 'Math : Math'],
					['NaN', 'NaN : number'],
					['undefined', 'undefined : any'],
					['', 'ecma6'],
					['ArrayBuffer(length)', ''],
					['DataView(buffer, byteOffset?, byteLength?)', ''],
					['Float32Array(length)', ''],
					['Float64Array(length)', ''],
					['Int16Array(length)', ''],
					['Int32Array(length)', ''],
					['Int8Array(length)', ''],
					['Map(iterable?)', ''],
					['Promise(executor)', ''],
					['Proxy(target, handler)', ''],
					['Set(iterable)', ''],
					['Symbol(description?)', ''],
					['TypedArray(length)', ''],
					['Uint16Array()', ''],
					['Uint32Array()', ''],
					['Uint8Array()', ''],
					['Uint8ClampedArray()', ''],
					['WeakMap(iterable)', ''],
					['WeakSet(iterable)', '']
				]);
			});
			it("test multi function content assist 1", function(done) {
				var options = {
					buffer: "function fun(a, b, c) {}\nfunction other(a, b, c) {}\n",
					prefix: '',
					offset: 52,
					callback: done
				};
				return testProposals(options, [
					['fun(a, b, c)', ''],
					['other(a, b, c)', ''],
					['exports', 'exports : exports'],
					['module', 'module : Module'],
 					['', 'ecma5'],
					['Array(size)', ''],
					['Boolean(value)', 'Boolean(value) : bool'],
					['Date(ms)', 'Date(ms)'],
					['Error(message)', ''],
					['EvalError(message)', ''],
					['Function(body)', 'Function(body) : fn()'],
					['Number(value)', 'Number(value) : number'],
					['Object()', 'Object()'],
					['RangeError(message)', ''],
					['ReferenceError(message)', ''],
					['RegExp(source, flags?)', ''],
					['String(value)', 'String(value) : string'],
					['SyntaxError(message)', ''],
					['TypeError(message)', ''],
					['URIError(message)', ''],
					['decodeURI(uri)', 'decodeURI(uri) : string'],
					['decodeURIComponent(uri)', 'decodeURIComponent(uri) : string'],
					['encodeURI(uri)', 'encodeURI(uri) : string'],
					['encodeURIComponent(uri)', 'encodeURIComponent(uri) : string'],
					['eval(code)', 'eval(code)'],
					['isFinite(value)', 'isFinite(value) : bool'],
					['isNaN(value)', 'isNaN(value) : bool'],
					['parseFloat(string)', 'parseFloat(string) : number'],
					['parseInt(string, radix?)', 'parseInt(string, radix?) : number'],
					['Infinity', 'Infinity : number'],
					['JSON', 'JSON : JSON'],
					['Math', 'Math : Math'],
					['NaN', 'NaN : number'],
					['undefined', 'undefined : any'],
					['', 'ecma6'],
					['ArrayBuffer(length)', ''],
					['DataView(buffer, byteOffset?, byteLength?)', ''],
					['Float32Array(length)', ''],
					['Float64Array(length)', ''],
					['Int16Array(length)', ''],
					['Int32Array(length)', ''],
					['Int8Array(length)', ''],
					['Map(iterable?)', ''],
					['Promise(executor)', ''],
					['Proxy(target, handler)', ''],
					['Set(iterable)', ''],
					['Symbol(description?)', ''],
					['TypedArray(length)', ''],
					['Uint16Array()', ''],
					['Uint32Array()', ''],
					['Uint8Array()', ''],
					['Uint8ClampedArray()', ''],
					['WeakMap(iterable)', ''],
					['WeakSet(iterable)', '']
				]);
			});
			it("test no dupe 1", function(done) {
				var options = {
					buffer: "var coo = 9; var other = function(coo) { c }", 
					prefix: "c", 
					offset: 42,
					callback: done
				};
				return testProposals(options, [
					["coo", "coo : any"]
				]);
			});
			it("test no dupe 2", function(done) {
				var options = {
					buffer: "var coo = { }; var other = function(coo) { coo = 9;\nc }", 
					prefix: "c", 
					offset: 53,
					callback: done
				};
				return testProposals(options, [
					["coo", "coo : number"]
				]);
			});
			it("test no dupe 3", function(done) {
				var options = {
					buffer: "var coo = function () { var coo = 9; \n c};", 
					prefix: "c", 
					offset: 40,
					callback: done
				};
				return testProposals(options, [
					["coo", "coo : number"]
				]);
			});
			it("test no dupe 4", function(done) {
				var options = {
					buffer: "var coo = 9; var other = function () { var coo = function() { return 9; }; \n c};", 
					prefix: "c", 
					offset: 78,
					callback: done
				};
				return testProposals(options, [
					["coo()", "coo() : number"]
				]);
			});
			it("test scopes 1", function(done) {
				// only the outer foo is available
				var options = {
					buffer: "var coo;\nfunction other(a, b, c) {\nfunction inner() { var coo2; }\nco}", 
					prefix: "co", 
					offset: 68,
					callback: done
				};
				return testProposals(options, [
					["coo", "coo : any"]
				]);
			});
			it("test scopes 2", function(done) {
				// the inner assignment should not affect the value of foo
				var options = {
					buffer: "var foo;\n var foo = 1;\nfunction other(a, b, c) {\nfunction inner() { foo2 = \"\"; }\nfoo.toF}", 
					prefix: "toF", 
					offset: 88,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test multi function content assist 2", function(done) {
				var options = {
					buffer: "function ffun(a, b, c) {}\nfunction other(a, b, c) {}\nff", 
					prefix: "ff",
					offset: 53,
					callback: done
				};
				return testProposals(options, [
					["ffun(a, b, c)", ""]
				]);
			});
		    /**
		     * Tests inferencing with $$-qualified members
		     * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=439628
		     * @since 7.0
		     */
		    it("test inferencing $$-qualified member types", function(done) {
				var options = {
					buffer: "var baz = foo.$$fntype && foo.$$fntype.foo;A", 
					prefix: "A", 
					offset: 44,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
				    ["Array(size)", "Array(size)"],
					['', 'ecma6'],
					['ArrayBuffer(length)', ''],
				]);
			});
			// all inferencing based content assist tests here
			it("test Object inferencing with Variable", function(done) {
				var options = {
					buffer: "var t = {}\nt.h", 
					prefix: "h",
					offset: 13,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["hasOwnProperty(prop)", "hasOwnProperty(prop) : bool"]
				]);
			});
			it("test Object Literal inferencing", function(done) {
				var options = {
					buffer: "var t = { hhh : 1, hh2 : 8}\nt.h", 
					prefix: "h",
					offset: 30,
					callback: done
				};
				return testProposals(options, [
					["hh2", "hh2 : number"],
					["hhh", "hhh : number"],
					["", "ecma5"],
					["hasOwnProperty(prop)", "hasOwnProperty(prop) : bool"]
				]);
			});
			it("test Simple String inferencing", function(done) {
				var options = {
					buffer: "''.char", 
					prefix: "char",
					offset: 7,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["charAt(i)", "charAt(i) : string"],
					["charCodeAt(i)", "charCodeAt(i) : number"]
				]);
			});
			it("test Simple Date inferencing", function(done) {
				var options = {
					buffer: "new Date().setD", 
					prefix: "setD",
					offset: 15,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["setDate(day)", "setDate(day) : number"]
				]);
			});
			it("test Number inferencing with Variable", function(done) {
				var options = {
					buffer: "var t = 1\nt.to", 
					prefix: "to",
					offset: 14,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["toExponential(digits)", "toExponential(digits) : string"],
					["toFixed(digits)", "toFixed(digits) : string"],
					["toLocaleString()", "toLocaleString() : string"],
					['toPrecision(digits)', 'toPrecision(digits) : string'],
					["toString(radix?)", "toString(radix?) : string"]
				]);
			});
			it("test Data flow Object Literal inferencing", function(done) {
				var options = {
					buffer: "var s = { hhh : 1, hh2 : 8}\nvar t = s;\nt.h", 
					prefix: "h",
					offset: 42,
					callback: done
				};
				return testProposals(options, [
					["hh2", "hh2 : number"],
					["hhh", "hhh : number"],
					["", "ecma5"],
					["hasOwnProperty(prop)", "hasOwnProperty(prop) : bool"]
				]);
			});
			it("test Data flow inferencing 1", function(done) {
				var options = {
					buffer: "var ttt = 9\nttt.toF", 
					prefix: "toF",
					offset: 19,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test Data flow inferencing 2", function(done) {
				var options = {
					buffer: "ttt = 9\nttt.toF", 
					prefix: "toF",
					offset: 15,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test Data flow inferencing 3", function(done) {
				var options = {
					buffer: "var ttt = ''\nttt = 9\nttt.toF", 
					prefix: "toF",
					offset: 28,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test Data flow inferencing 4", function(done) {
				var options = {
					buffer: "var name = toString(property.key.value);\nname.co", 
					prefix: "co",
					offset: 48,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma6'],
					['codePointAt(pos)', 'codePointAt(pos) : number'],
					['', 'ecma5'],
					["concat(other)", "concat(other) : string"]
				]);
			});
			it("test Simple this", function(done) {
				var options = {
					buffer: "var ssss = 4;\nthis.ss", 
					prefix: "ss",
					offset: 21,
					callback: done
				};
				return testProposals(options, [
					//["ssss", "ssss : number"]
				]);
			});
			it("test Object Literal inside", function(done) {
				var options = {
					buffer: "var x = { the : 1, far : this.th };", 
					prefix: "th", 
					offset: 32,
					callback: done
				};
				return testProposals(options, [
					["the", "the : number"]
				]);
			});
			it("test Object Literal outside", function(done) {
				var options = {
					buffer: "var x = { the : 1, far : 2 };\nx.th", 
					prefix: "th",
					offset: 34,
					callback: done
				};
				return testProposals(options, [
					["the", "the : number"]
				]);
			});
			it("test Object Literal none", function(done) {
				var options = {
					buffer: "var x = { the : 1, far : 2 };\nthis.th", 
					prefix: "th",
					offset: 37,
					callback: done
				};
				return testProposals(options, [
					["the", "the : number"]
				]);
			});
			it("test Object Literal outside 2", function(done) {
				var options = {
					buffer: "var x = { the : 1, far : 2 };\nvar who = x.th", 
					prefix: "th",
					offset: 44,
					callback: done
				};
				return testProposals(options, [
					["the", "the : number"]
				]);
			});
			it("test Object Literal outside 3", function(done) {
				var options = {
					buffer: "var x = { the : 1, far : 2 };\nwho(x.th)", 
					prefix: "th", 
					offset: 38,
					callback: done
				};
				return testProposals(options, [
					["the", "the : number"]
				]);
			});
			it("test Object Literal outside 4", function(done) {
				var options = {
					buffer: "var x = { the : 1, far : 2 };\nwho(yyy, x.th)", 
					prefix: "th",
					offset: 43,
					callback: done
				};
				return testProposals(options, [
					["the", "the : number"]
				]);
			});
			it("test this reference 1", function(done) {
				var options = {
					buffer: "var xxxx;\nthis.x", 
					prefix: "x",
					offset: 16,
					callback: done
				};
				return testProposals(options, [
					///["xxxx", "xxxx : any"]
				]);
			});
			it("test binary expression 1", function(done) {
				var options = {
					buffer: "(1+3).toF", 
					prefix: "toF",
					offset: 9,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["toFixed(digits)", "toFixed(digits) : string"]
				]);
			});
			it("test for loop 1", function(done) {
				var options = {
					buffer: "for (var ii=0;i<8;ii++) { ii }", 
					prefix: "i", 
					offset: 15,
					callback: done
				};
				return testProposals(options, [
					["ii", "ii : number"],
					['', 'ecma5'],
					["isFinite(value)", "isFinite(value) : bool"],
					["isNaN(value)", "isNaN(value) : bool"],
					["isPrototypeOf(obj)", "isPrototypeOf(obj) : bool"],
					//["Infinity", "Infinity : number"],
				]);
			});
			it("test for loop 2", function(done) {
				var options = {
					buffer: "for (var ii=0;ii<8;i++) { ii }", 
					prefix: "i", 
					offset: 20,
					callback: done
				};
				return testProposals(options, [
					["ii", "ii : number"],
					['', 'ecma5'],
					["isFinite(value)", "isFinite(value) : bool"],
					["isNaN(value)", "isNaN(value) : bool"],
					["isPrototypeOf(obj)", "isPrototypeOf(obj) : bool"],
					//["Infinity", "Infinity : number"]
				]);
			});
			it("test for loop 3", function(done) {
				var options = {
					buffer: "for (var ii=0;ii<8;ii++) { i }", 
					prefix: "i", 
					offset: 28,
					callback: done
				};
				return testProposals(options, [
					["ii", "ii : number"],
					['', 'ecma5'],
					["isFinite(value)", "isFinite(value) : bool"],
					["isNaN(value)", "isNaN(value) : bool"],
					["isPrototypeOf(obj)", "isPrototypeOf(obj) : bool"],
					//["Infinity", "Infinity : number"],
				]);
			});
			it("test while loop 1", function(done) {
				var options = {
					buffer: "var iii;\nwhile(ii === null) {\n}", 
					prefix: "ii", 
					offset: 17,
					callback: done
				};
				return testProposals(options, [
					["iii", "iii : any"]
				]);
			});
			it("test while loop 2", function(done) {
				var options = {
					buffer: "var iii;\nwhile(this.ii === null) {\n}", 
					prefix: "ii", 
					offset: 22,
					callback: done
				};
				return testProposals(options, [
					//TODO does not find global defined in global
					//["iii", "iii : any"]
				]);
			});
			it("test while loop 3", function(done) {
				var options = {
					buffer: "var iii;\nwhile(iii === null) {this.ii\n}", 
					prefix: "ii", 
					offset: 37,
					callback: done
				};
				return testProposals(options, [
					//TODO does not find global defined in global
					//["iii", "iii : any"]
				]);
			});
			it("test catch clause 1", function(done) {
				var options = {
					buffer: "try { } catch (eee) {e  }", 
					prefix: "e", 
					offset: 22,
					callback: done
				};
				return testProposals(options, [
					//TODO does not propose Error
					//["eee", "eee : Error"],
					['exports', 'exports : exports'],
					["", "ecma5"],
					["encodeURI(uri)", "encodeURI(uri) : string"],
					["encodeURIComponent(uri)", "encodeURIComponent(uri) : string"],
					["eval(code)", "eval(code)"]
				]);
			});
			it("test catch clause 2", function(done) {
				// the type of the catch variable is Error
				var options = {
					buffer: "try { } catch (eee) {\neee.me  }", 
					prefix: "me", 
					offset: 28,
					callback: done
				};
				return testProposals(options, [
					['', 'ecma5'],
					["message", "message : string"]
				]);
			});
			/**
			 * Tests RegExp proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426733
			 * @since 7.0
			 */
			it("test RegExp literal 1", function(done) {
				var options = {
					buffer: "/^.*/.t", 
					prefix: "t", 
					offset: 6,
					callback: done};
				testProposals(options, [
						['', 'ecma5'],
						['test(input)', 'test(input) : bool'],
						['toLocaleString()', 'toLocaleString() : string'],
						['toString()', 'toString() : string'],
					]);
			});
			
			/**
			 * Tests RegExp proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426733
			 * @since 7.0
			 */
			it("test RegExp literal 2", function(done) {
				var options = {
					buffer: "/^.*/.e", 
					prefix: "e", 
					offset: 7,
					callback: done};
				testProposals(options, [
						['', 'ecma5'],
						['exec(input)', 'exec(input) : [string]']
					]);
			});
			
			/**
			 * Tests proposal doc for function expressions
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=458693
			 * @since 8.0
			 */
			it("test func expr doc 1", function(done) {
				var options = {
					buffer: "var f = { /** \n* @returns {Array.<String>} array or null\n*/\n one: function() {}};\n f.", 
					prefix: "o", 
					offset: 85,
					callback: done};
				testProposals(options, [
				//TODO should we use guessing here?
					['one()', 'one()']
				]);
			});
			
			/**
			 * Tests proposal doc for function expressions
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=458693
			 * @since 8.0
			 */
			it("test func expr doc 2", function(done) {
				var options = {
					buffer: "var f = { /** \n* @return {Array.<String>} array or null\n*/\n one: function() {}};\n f.", 
					prefix: "o", 
					offset: 84,
					callback: done};
				testProposals(options, [
					['one()', 'one()']
				]);
			});
			
			/**
			 * Tests proposal doc for function decls
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=458693
			 * @since 8.0
			 */
			it("test func decl doc 1", function(done) {
				var options = {
					buffer: "/** @returns {Object} Something or nothing */ function z(a) {} z", 
					prefix: "z", 
					offset: 64,
					callback: done};
				testProposals(options, [
					['z(a)', 'z(a)']
				]);
			});
		});
		describe('Function Templates and Keywords', function() {
			/**
			 * https://bugs.eclipse.org/bugs/show_bug.cgi?id=425675
			 * @since 5.0
			 */
			it("test completions for Function1", function(done) {
				var options = {
					buffer: "var foo; foo !== null ? fun : function(f2) {};", 
					prefix: "fun",
					offset: 27,
					templates: true,
					keywords: true,
					callback: done};
				return testProposals(options, [
						//proposal, description
						['', 'Keywords'],
						["function", "function - Keyword"],
						["", "Templates"], 
						["/**\n * @name name\n * @param parameter\n */\nfunction name (parameter) {\n\t\n}", "function - function declaration"]
						]);
			});
			/**
			 * https://bugs.eclipse.org/bugs/show_bug.cgi?id=425675
			 * @since 5.0
			 */
			it("test completions for Function2", function(done) {
				var options = {
					buffer: "var foo; foo !== null ? function(f2) {} : fun;",
					prefix: "fun",
					offset: 45,
					templates: true,
					keywords: true,
					callback: done
				};
				return testProposals(options, [
						//proposal, description
						['', 'Keywords'],
						["function", "function - Keyword"],
						["", "Templates"], 
						["/**\n * @name name\n * @param parameter\n */\nfunction name (parameter) {\n\t\n}", "function - function declaration"],
						]);
			});
			/**
			 * https://bugs.eclipse.org/bugs/show_bug.cgi?id=425675
			 * @since 5.0
			 */
			it("test completions for Function3", function(done) {
				var options = {
					buffer: "var foo = {f: fun};", 
					prefix: 'fun',
					offset: 17,
					templates: true,
					keywords: true,
					callback: done
				};
				return testProposals(options, [
						//proposal, description
						['', 'Keywords'],
						["function", "function - Keyword"],
						["", "Templates"], 
						['ction(parameter) {\n\t\n}', 'function - member function expression'],
						]);
			});
			/**
			 * https://bugs.eclipse.org/bugs/show_bug.cgi?id=425675
			 * @since 5.0
			 */
			it("test completions for Function4", function(done) {
				var options = {
					buffer: "var foo = {f: fun};", 
					prefix: 'fun',
					offset: 17,
					templates: true,
					keywords: true,
					callback: done
				};
				return testProposals(options, [
						//proposal, description
						['', 'Keywords'],
						["function", "function - Keyword"],
						["", "Templates"], 
						['ction(parameter) {\n\t\n}', 'function - member function expression'],
						]);
			});
			/**
			 * https://bugs.eclipse.org/bugs/show_bug.cgi?id=425675
			 * @since 5.0
			 */
			it("test completions for Function5", function(done) {
				var options = {
					buffer: "fun", 
					prefix: 'fun',
					offset: 3,
					templates: true,
					keywords: true,
					callback: done
				};
				return testProposals(options, [
						//proposal, description
						['', 'Keywords'],
						["function", "function - Keyword"],
						["", "Templates"], 
						["/**\n * @name name\n * @param parameter\n */\nfunction name (parameter) {\n\t\n}", "function - function declaration"],
						]);
			});
			/*
			 * https://bugs.eclipse.org/bugs/show_bug.cgi?id=426284
			 * @since 6.0
			 */
			it("test completions for Function6", function(done) {
				var options = {
					buffer: "var foo = {f: t};", 
					prefix: 't',
					offset: 15,
					keywords:true, 
					templates:true,
					callback: done
				};
				return testProposals(options, [
						//proposal, description
						['', 'Keywords'],
						["this", "this - Keyword"],
						['throw', 'throw - Keyword'],
						['try', 'try - Keyword'],
						["typeof", "typeof - Keyword"],
						['', 'ecma5'],
						["toLocaleString()", "toLocaleString() : string"],
						["toString()", "toString() : string"],
						
						]);
			});
			/**
			 * https://bugs.eclipse.org/bugs/show_bug.cgi?id=426284
			 * @since 6.0
			 */
			it("test completions for Function7", function(done) {
				var options = {
					buffer: "var foo = {f: h};", 
					prefix: 'h',
					offset: 15,
					keywords: true, 
					templates: true,
					callback: done
				};
				return testProposals(options, [
						['', 'ecma5'],
						['hasOwnProperty(prop)', 'hasOwnProperty(prop) : bool']
						]);
			});
			
			/**
			 * https://bugs.eclipse.org/bugs/show_bug.cgi?id=426284
			 * @since 6.0
			 */
			it("test completions for Function8", function(done) {
				var options = {
					buffer: "var foo = {f: n};", 
					prefix: 'n',
					offset: 15,
					keywords: true, 
					templates: true,
					callback: done
				};
				return testProposals(options, [
						//proposal, description
						['', 'Keywords'],
						["new", "new - Keyword"]
						]);
			});
		});
		describe('ESLint Directive Tests', function() {
			/**
			 * Tests the eslint* templates in source
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 */
			it("test eslint* template 1", function(done) {
				var options = {
					buffer: "es", 
					prefix: "es", 
					offset: 2,
					callback: done,
					templates: true
				};
				testProposals(options, [
					['', 'Templates'],
				    ['/* eslint rule-id:0/1*/', 'eslint - ESLint rule enable / disable directive'],
				    ['/* eslint-disable rule-id */', 'eslint-disable - ESLint rule disablement directive'],
				    ['/* eslint-enable rule-id */', 'eslint-enable - ESLint rule enablement directive'],
				    ['/* eslint-env library*/', 'eslint-env - ESLint environment directive']]
				);
			});
			/**
			 * Tests the eslint* templates in comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 */
			it("test eslint* template 2", function(done) {
				var options = {
					buffer: "/* es", 
					prefix: "es", 
					offset: 5,
					callback: done,
					templates: true
				};
				testProposals(options, [
					['', 'Templates'],
				    ['lint rule-id:0/1 ', 'eslint - ESLint rule enable or disable'],
				    ['lint-disable rule-id ', 'eslint-disable - ESLint rule disablement directive'],
				    ['lint-enable rule-id ', 'eslint-enable - ESLint rule enablement directive'],
				    ['lint-env library', 'eslint-env - ESLint environment directive']]
				);
			});
			/**
			 * Tests the eslint* templates in comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 */
			it("test eslint* template 3", function(done) {
				var options = {
					buffer: "/* es */", 
					prefix: "es", 
					offset: 5,
					callback: done,
					templates: true
				};
				testProposals(options, [
					['', 'Templates'],
				    ['lint rule-id:0/1 ', 'eslint - ESLint rule enable or disable'],
				    ['lint-disable rule-id ', 'eslint-disable - ESLint rule disablement directive'],
				    ['lint-enable rule-id ', 'eslint-enable - ESLint rule enablement directive'],
				    ['lint-env library', 'eslint-env - ESLint environment directive']]
				);
			});
			/**
			 * Tests the eslint* templates in comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 */
			it("test eslint* template 4", function(done) {
				var options = {
					buffer: "var f; /* es", 
					prefix: "es", 
					offset: 12,
					callback: done,
					templates: true
				};
				testProposals(options, [
					['', 'Templates'],
				    ['lint rule-id:0/1 ', 'eslint - ESLint rule enable or disable'],
				    ['lint-disable rule-id ', 'eslint-disable - ESLint rule disablement directive'],
				    ['lint-enable rule-id ', 'eslint-enable - ESLint rule enablement directive'],
				    ['lint-env library', 'eslint-env - ESLint environment directive']]
				);
			});
			/**
			 * Tests that no eslint* templates are in jsdoc comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 */
			it("test eslint* template 5", function(done) {
				var options = {
					buffer: "/** es", 
					prefix: "es", 
					offset: 6,
					callback: done,
					templates: true
				};
				testProposals(options, []);
			});
			/**
			 * Tests that eslint* templates will be proposed further in comment with no content beforehand
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint* template 6", function(done) {
				var options = {
					buffer: "/* \n\n es", 
					prefix: "es", 
					offset: 10,
					callback: done,
					templates: true
				};
				testProposals(options, [
					['','Templates'],
				    ['/* eslint rule-id:0/1*/', 'eslint - ESLint rule enable / disable directive'],
				    ['/* eslint-disable rule-id */', 'eslint-disable - ESLint rule disablement directive'],
				    ['/* eslint-enable rule-id */', 'eslint-enable - ESLint rule enablement directive'],
				    ['/* eslint-env library*/', 'eslint-env - ESLint environment directive']]
				);
			});
			/**
			 * Tests that no eslint* templates are in comments after other content
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
//			it("test eslint* template 7", function(done) {
//				var options = {
//					buffer: "/* foo \n\n es", 
//					prefix: "es", 
//					offset: 10,
//					callback: done,
//					templates: true
//				};
//				testProposals(options, []);
//			});
			/**
			 * Tests that no eslint* templates are proposed when there is already one
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint* template 9", function(done) {
				var options = {
					buffer: "/* eslint ", 
					prefix: "eslint", 
					offset: 9,
					callback: done,
					templates: true
				};
	            testProposals(options, [
	            	['', 'Templates'],
				    [' rule-id:0/1 ', 'eslint - ESLint rule enable or disable'],
				    ['-disable rule-id ', 'eslint-disable - ESLint rule disablement directive'],
				    ['-enable rule-id ', 'eslint-enable - ESLint rule enablement directive'],
				    ['-env library', 'eslint-env - ESLint environment directive']]
				);
			});
			/**
			 * Tests that eslint-env environs are proposed
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint-env proposals 1", function(done) {
				var options = {
					buffer: "/* eslint-env ", 
					prefix: "", 
					offset: 14,
					callback: done,
					templates: true
				};
				testProposals(options, [
				     ['amd', 'amd - ESLint environment name'],
				     ['browser', 'browser - ESLint environment name'],
				     ['jasmine', 'jasmine - ESLint environment name'],
					 ['jquery', 'jquery - ESLint environment name'],
					 ['meteor', 'meteor - ESLint environment name'],
				     ['mocha', 'mocha - ESLint environment name'],
				     ['node', 'node - ESLint environment name'],
				     ['phantomjs', 'phantomjs - ESLint environment name'],
					 ['prototypejs', 'prototypejs - ESLint environment name'],
					 ['shelljs', 'shelljs - ESLint environment name']
				     ]);
			});
			/**
			 * Tests that eslint-env environs are proposed
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint-env proposals 2", function(done) {
				var options = {
					buffer: "/* eslint-env a", 
					prefix: "a", 
					offset: 15,
					callback: done,
					templates: true
				};
				testProposals(options, [
				     ['amd', 'amd - ESLint environment name'],
				     ]);
			});
			/**
			 * Tests that eslint rules are proposed
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint rule proposals 1", function(done) {
				var options = {
					buffer: "/* eslint c", 
					prefix: "c", 
					offset: 11,
					callback: done,
					templates: true
				};
				testProposals(options, [
				     ['curly', 'curly - ESLint rule']
				     ]);
			});
			/**
			 * Tests that eslint rules are proposed
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint rule proposals 2", function(done) {
				var options = {
					buffer: "/* eslint no-js", 
					prefix: "no-js", 
					offset: 15,
					callback: done,
					templates: true
				};
				testProposals(options, [
				     ['no-jslint', 'no-jslint - ESLint rule'],
				     ]);
			});
			/**
			 * Tests that eslint rules are proposed
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint rule proposals 3", function(done) {
				var options = {
					buffer: "/* eslint-enable no-js", 
					prefix: "no-js", 
					offset: 22,
					callback: done,
					templates: true
				};
				testProposals(options, [
				     ['no-jslint', 'no-jslint - ESLint rule'],
				     ]);
			});
			/**
			 * Tests that eslint rules are proposed
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint rule proposals 4", function(done) {
				var options = {
					buffer: "/* eslint-disable no-js", 
					prefix: "no-js", 
					offset: 23,
					callback: done,
					templates: true
				};
				testProposals(options, [
				     ['no-jslint', 'no-jslint - ESLint rule'],
				     ]);
			});
			/**
			 * Tests that eslint rules are proposed
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=440569
			 * @since 7.0
			 */
			it("test eslint rule proposals 5", function(done) {
				var options = {
					buffer: "/* eslint-enable no-jslint, c", 
					prefix: "c", 
					offset: 29,
					callback: done,
					templates: true
				};
				testProposals(options, [
				     ['curly', 'curly - ESLint rule']
				     ]);
			});
		});
		describe('MySQl Index Tests', function() {
			/*
			 * Tests mysql index
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 7.0
			 */
			it("test mysql index 1", function(done) {
				var options = {
					buffer: "/*eslint-env mysql*/ require('mysql').createP", 
					prefix: "createP", 
					offset: 45,
					callback: done
				};
				testProposals(options, [
					['', 'mysql'],
				    ['createPool(config)', 'createPool(config) : mysql.Pool'],
				    ['createPoolCluster(config?)', 'createPoolCluster(config?) : mysql.PoolCluster']
				]);
			});
			/*
			 * Tests mysql index
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 7.0
			 */
			it("test mysql index 2", function(done) {
				var options = {
					buffer: "/*eslint-env mysql*/ require('mysql').createPoolC", 
					prefix: "createPoolC", 
					offset: 49,
					callback: done
				};
				testProposals(options, [
					['', 'mysql'],
				    ['createPoolCluster(config?)', 'createPoolCluster(config?) : mysql.PoolCluster']
				]);
			});
			/*
			 * Tests mysql index
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 7.0
			 */
			it("test mysql index 3", function(done) {
				var options = {
					buffer: "/*eslint-env mysql*/ require('mysql').createQ", 
					prefix: "createQ", 
					offset: 45,
					callback: done
				};
				testProposals(options, [
					['', 'mysql'],
				    ['createQuery(sql)', 'createQuery(sql)']
				]);
			});
			/*
			 * Tests mysql index for indirect proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 7.0
			 */
			it("test mysql index 4", function(done) {
				var options = {
					buffer: "/*eslint-env mysql*/ require('mysql').createQuery(null,null,null).sta",
					prefix: "sta", 
					offset: 69,
					callback:done
				};
				testProposals(options, [
					['', 'mysql'],
				    ['start()', 'start()'],
				    ['', 'ecma6'],
				    ['startsWith(searchString, position?)', 'startsWith(searchString, position?) : bool']
				]);
			});
			/**
			 * Tests no proposals are returned without the eslint-env directive
			 * @since 10.0
			 */
			it("test mysql empty 1", function(done) {
				var options = {
					buffer: "require('mysql').createQuery(null,null,null).",
					prefix: "sta", 
					offset: 45,
					callback:done
				};
				testProposals(options, [
				]);
			});
		});
		describe('Redis Index Tests', function() {
			/**
			 * Tests redis index indirect proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 7.0
			 */
			it("test redis index 1", function(done) {
				var options = {
					buffer: "/*eslint-env redis*/ require('redis').createClient(null, null, null).a", 
					prefix: "a", 
					offset: 70,
					callback: done};
				testProposals(options, [
					['', 'redis'],
				    ['append(key, value, callback?)', 'append(key, value, callback?)'],
				    ['auth(password, callback?)', 'auth(password, callback?)']
				]);
			});
			
			/**
			 * Tests redis index 
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 7.0
			 */
			it("test redis index 2", function(done) {
				var options = {
					buffer: "/*eslint-env redis*/ require('redis').c", 
					prefix: "c", 
					offset: 39,
					callback: done};
				testProposals(options, [
					['', 'redis'],
				    ['createClient(port_arg, host_arg?, options?)', 'createClient(port_arg, host_arg?, options?) : RedisClient']
				]);
			});
			
			/**
			 * Tests redis index 
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 10.0
			 */
			it("test redis index no proposals 1", function(done) {
				var options = {
					buffer: "require('redis').c", 
					prefix: "c", 
					offset: 18,
					callback: done};
				testProposals(options, [
				]);
			});
		});
		describe('Postgres Index Tests', function() {
			/**
			 * Tests pg index indirect proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 7.0
			 */
			it("test pg index 1", function(done) {
				var options = {
					buffer: "/*eslint-env pg*/require('pg').c", 
					prefix: "c", 
					offset: 32,
					callback: done};
				testProposals(options, [
					['', 'pg'],
				    ['connect(connection, callback)', 'connect(connection, callback)'],
				]);
			});
			
			/**
			 * Tests redis index 
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 7.0
			 */
			it("test pg index 2", function(done) {
				var options = {
					buffer: "/*eslint-env pg*/require('pg').Cl", 
					prefix: "Cl", 
					offset: 33,
					callback: done};
				testProposals(options, [
					['', 'pg'],
				    ['Client(connection)', 'Client(connection)']
				]);
			});
			/**
			 * Tests redis index 
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426486
			 * @since 10.0
			 */
			it("test pg index no proposals 1", function(done) {
				var options = {
					buffer: "require('pg').Cl", 
					prefix: "Cl", 
					offset: 16,
					callback: done};
				testProposals(options, [
				]);
			});
		});
		describe('Comment Assist Tests', function() {
			/**
			 * Tests line comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=443521
			 * @since 7.0
			 */
			it("test line comment 1", function(done) {
				var options = {
					buffer: "//  ", 
					prefix: "", 
					offset: 4,
					callback: done};
				testProposals(options, []);
			});
			
			/**
			 * Tests line comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=443521
			 * @since 7.0
			 */
			it("test line comment 2", function(done) {
				var options = {
					buffer: "// foo ", 
					prefix: "", 
					offset: 3,
					callback: done};
				testProposals(options, []);
			});
			
			/**
			 * Tests line comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=443521
			 * @since 7.0
			 */
			it("test line comment 3", function(done) {
				var options = {
					buffer: "// foo ", 
					prefix: "", 
					offset: 7,
					callback: done};
				testProposals(options, []);
			});
			
			/**
			 * Tests line comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=443521
			 * @since 7.0
			 */
			it("test line comment 4", function(done) {
				var options = {
					buffer: "// cur ", 
					prefix: "c", 
					offset: 4,
					callback: done};
				testProposals(options, []);
			});
			
			/**
			 * Tests line comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=443521
			 * @since 7.0
			 */
			it("test line comment 5", function(done) {
				var options = {
					buffer: "// es ", 
					prefix: "es", 
					offset: 5,
					callback: done};
				testProposals(options, []);
			});
			
			/**
			 * Tests line comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=444001
			 * @since 7.0
			 */
			it("test line comment 6", function(done) {
				var options = {
					buffer: "// .", 
					prefix: "", 
					offset: 4,
					callback: done};
				testProposals(options, []);
			});
			
			/**
			 * Tests line comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=444001
			 * @since 7.0
			 */
			it("test line comment 7", function(done) {
				var options = {
					buffer: "// . es", 
					prefix: "", 
					offset: 4,
					callback: done};
				testProposals(options, []);
			});
			
			/**
			 * Tests line comments
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=444001
			 * @since 7.0
			 */
			it("test line comment 8", function(done) {
				var options = {
					buffer: "// es .", 
					prefix: "", 
					offset: 7,
					callback: done};
				testProposals(options, []);
			});
			/**
			 * Tests the author tag insertion
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test author tag", function(done) {
				var options = {
					buffer: "/**\n* @a \n*/", 
					prefix: "@a", 
					offset: 8,
					templates: true,
					callback: done};
				testProposals(options, [
					['', 'Templates'],
				    ['uthor ', '@author - Author JSDoc tag']
				]);
			});
			/**
			 * Tests the lends tag insertion
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test lends tag", function(done) {
				var options = {
					buffer: "/**\n* @name foo\n* @l \n*/", 
					prefix: "@l", 
					offset: 20,
					templates: true,
					callback: done};
				testProposals(options, [
					['', 'Templates'],
				    ['ends ', '@lends - Lends JSDoc tag'],
				    ['icense ', '@license - License JSDoc tag']
				]);
			});
			/**
			 * Tests the function name insertion for a function decl with no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test name tag completion 1", function(done) {
				var options = {
					buffer: "/**\n* @name  \n*/ function a(){}", 
					line: '* @name  ',
					prefix: "", 
					offset: 13,
					callback: done};
				testProposals(options, [
				     ['a', 'a - The name of the function']
				]);
			});
			/**
			 * Tests the function name insertion for a function decl with no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 10.0
			 */
			it("test name tag completion 1a - no space", function(done) {
				var options = {
					buffer: "/**\n* @name  \n*/function a(){}", 
					prefix: "",
					line: '* @name  ',
					offset: 13,
					callback: done};
				testProposals(options, [
				     ['a', 'a - The name of the function']
				]);
			});
			/**
			 * Tests the function name insertion for a function decl with a prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test name tag completion 2", function(done) {
				var options = {
					buffer: "/**\n* @name  \n*/ function bar(){}",
					line: '* @name  ',
					prefix: "b", 
					offset: 13,
					callback: done};
				testProposals(options, [
				     ['bar', 'bar - The name of the function']
				]);
			});
			/**
			 * Tests the function name insertion for a object property with function expr with no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test name tag completion 3", function(done) {
				var options = {
					buffer: "var o = {/**\n* @name  \n*/f: function bar(){}}",
					line: '* @name  ',
					prefix: "", 
					offset: 21,
					callback: done};
				testProposals(options, [
				     ['bar', 'bar - The name of the function']
				]);
			});
			/**
			 * Tests the function name insertion for a object property with function expr with a prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test name tag completion 4", function(done) {
				var options = {
					buffer: "var o = {/**\n* @name  \n*/f: function bar(){}}", 
					line: '* @name  ',
					prefix: "b", 
					offset: 21,
					callback: done};
				testProposals(options, [
				     ['bar', 'bar - The name of the function']
				]);
			});
			/**
			 * Tests the function name insertion for a object property with function expr with no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test name tag completion 5", function(done) {
				var options = {
					buffer: "/**\n* @name  \n*/ Foo.bar.baz = function(){}",
					line: '* @name  ',
					prefix: "", 
					offset: 12,
					callback: done};
				testProposals(options, [
				     ['Foo.bar.baz', 'Foo.bar.baz - The name of the function']
				]);
			});
			/**
			 * Tests the function name insertion for a object property with function expr with a prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test name tag completion 6", function(done) {
				var options = {
					buffer: "/**\n* @name  \n*/ Foo.bar.baz = function(){}",
					line: '* @name  ',
					prefix: "Foo", 
					offset: 12,
					callback: done};
				testProposals(options, [
				     ['Foo.bar.baz', 'Foo.bar.baz - The name of the function']
				]);
			});
			/**
			 * Tests no proposals for assignment expression
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test name tag completion 6a", function(done) {
				var options = {
					buffer: "/**\n* @name f \n*/Foo.bar.baz = function(){}",
					line: '* @name f ',
					prefix: "", 
					offset: 14,
					callback: done};
				testProposals(options, []);
			});
			/**
			 * Tests func decl param name proposals no prefix, no type
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 1", function(done) {
				var options = {
					buffer: "/**\n* @param  \n*/ function a(a, b, c){}",
					line: '* @param  ',
					prefix: "", 
					offset: 13,
					callback: done};
				testProposals(options, [
				     ['a', 'a - Function parameter'],
				     ['b', 'b - Function parameter'],
				     ['c', 'c - Function parameter']
				]);
			});
			
			/**
			 * Tests func decl param name proposals no prefix, no type
			 * @since 10.0
			 */
			it("test param name completion whitespace 1", function(done) {
				var options = {
					buffer: "/**\n* @param  \n*/function a(a, b, c){}",
					line: '* @param  ',
					prefix: "", 
					offset: 13,
					callback: done};
				testProposals(options, [
				  ['a', 'a - Function parameter'],
				  ['b', 'b - Function parameter'],
				  ['c', 'c - Function parameter']
				]);
			});
			
			/**
			 * Tests func decl param name proposals no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 2", function(done) {
				var options = {
					buffer: "/**\n* @param {type} \n*/ function a(a, b, c){}",
					line: '* @param {type} ',
					prefix: "", 
					offset: 20,
					callback: done};
				testProposals(options, [
				     ['a', 'a - Function parameter'],
				     ['b', 'b - Function parameter'],
				     ['c', 'c - Function parameter']
				]);
			});
			/**
			 * Tests func decl param name proposals a prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 3", function(done) {
				var options = {
					buffer: "/**\n* @param a \n*/ function a(aa, bb, cc){}", 
					line: '* @param a ',
					prefix: "a", 
					offset: 14,
					callback: done};
				testProposals(options, [
				     ['aa', 'aa - Function parameter']
				]);
			});
			/**
			 * Tests no proposals for after name
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 4", function(done) {
				var options = {
					buffer: "/**\n* @param f  \n*/ function a(aa, bb, cc){}", 
					line: '* @param f  ',
					prefix: "", 
					offset: 15,
					callback: done};
				testProposals(options, []);
			});
			/**
			 * Tests object property func expr param name proposals no prefix, no type
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 5", function(done) {
				var options = {
					buffer: "var o = {/**\n* @param  \n*/f: function a(a, b, c){}}", 
					line: '* @param  ',
					prefix: "", 
					offset: 22,
					callback: done};
				testProposals(options, [
				     ['a', 'a - Function parameter'],
				     ['b', 'b - Function parameter'],
				     ['c', 'c - Function parameter']
				]);
			});
			/**
			 * Tests object property func expr param name proposals no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 6", function(done) {
				var options = {
					buffer: "var o = {/**\n* @param {type} \n*/f: function a(a, b, c){}}", 
					line: '* @param {type} ',
					prefix: "", 
					offset: 29,
					callback: done};
				testProposals(options, [
				     ['a', 'a - Function parameter'],
				     ['b', 'b - Function parameter'],
				     ['c', 'c - Function parameter']
				]);
			});
			/**
			 * Tests object property func expr param name proposals a prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 7", function(done) {
				var options = {
					buffer: "var o = {/**\n* @param {type} a\n*/f: function a(aa, bb, cc){}}", 
					line: '* @param {type} a',
					prefix: "a", 
					offset: 30,
					callback: done};
				testProposals(options, [
				     ['aa', 'aa - Function parameter']
				]);
			});
			/**
			 * Tests object property func expr param name proposals a prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 8", function(done) {
				var options = {
					buffer: "var o = {/**\n* @param {type} a \n*/f: function a(aa, bb, cc){}}",
					line: '* @param {type} a ',
					prefix: "a", 
					ofset: 31,
					callback: done};
				testProposals(options, []);
			});
			/**
			 * Tests assingment func expr param name proposals no prefix, no type
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 9", function(done) {
				var options = {
					buffer: "/**\n* @param  \n*/ Foo.bar.baz = function a(a, b, c){}", 
					line: '* @param  ',
					prefix: "", 
					offset: 13,
					callback: done};
				testProposals(options, [
				     ['a', 'a - Function parameter'],
				     ['b', 'b - Function parameter'],
				     ['c', 'c - Function parameter']
				]);
			});
			/**
			 * Tests assingment func expr param name proposals no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 10", function(done) {
				var options = {
					buffer: "/**\n* @param {type} \n*/ Foo.bar.baz = function a(a, b, c){}", 
					line: '* @param {type} ',
					prefix: "", 
					offset: 20,
					callback: done};
				testProposals(options, [
				     ['a', 'a - Function parameter'],
				     ['b', 'b - Function parameter'],
				     ['c', 'c - Function parameter']
				]);
			});
			/**
			 * Tests assingment func expr param name proposals no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 10a", function(done) {
				var options = {
					buffer: "/**\n* @param {type} a\n*/Foo.bar.baz = function a(aa, bb, cc){}", 
					line: '* @param {type} a',
					prefix: "a", 
					offset: 21,
					callback: done};
				testProposals(options, [
				     ['aa', 'aa - Function parameter']
				]);
			});
			/**
			 * Tests assingment func expr param name proposals no prefix
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test param name completion 11", function(done) {
				var options = {
					buffer: "/**\n* @param {type} d\n*/ Foo.bar.baz = function a(aa, bb, cc){}", 
					line: '* @param {type} d',
					prefix: "d", 
					offset: 20,
					callback: done};
				testProposals(options, []);
			});
			
			/**
			 * Tests var decl func expr param name proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=473425
			 * @since 10.0
			 */
			it("test param name completion 12", function(done) {
				var options = {
					buffer: "/**\n* @param {type} d\n*/var Foo.bar.baz = function a(aa, bb, cc){}", 
					line: '* @param {type} d',
					prefix: "d", 
					offset: 20,
					callback: done};
				testProposals(options, []);
			});
			/**
			 * Tests var decl func expr param name proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=473425
			 * @since 10.0
			 */
			it("test param name completion 13", function(done) {
				var options = {
					buffer: "/**\n* @param {type} a\n*/var baz = function a(aa, bb, cc){}", 
					line: '* @param {type} a',
					prefix: "a", 
					offset: 21,
					callback: done};
				testProposals(options, [
					['aa', 'aa - Function parameter']
				]);
			});
			
			/**
			 * Tests var decl func expr name proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=473425
			 * @since 10.0
			 */
			it("test param name completion 14", function(done) {
				var options = {
					buffer: "/**\n* @name \n*/var baz = function baz(aa, bb, cc){}", 
					line: '* @name ',
					prefix: "", 
					offset: 12,
					callback: done};
				testProposals(options, [
					['baz', 'baz - The name of the function']
				]);
			});
			
			/**
			 * Tests var decl func expr name proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=473425
			 * @since 10.0
			 */
			it("test param name completion 15", function(done) {
				var options = {
					buffer: "/**\n* @name \n*/var baz = function foo(aa, bb, cc){}", 
					line: '* @name ',
					prefix: "", 
					offset: 12,
					callback: done};
				testProposals(options, [
					['foo', 'foo - The name of the function']
				]);
			});
			
			/**
			 * Tests var decl func expr name proposals
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=473425
			 * @since 10.0
			 */
			it("test param name completion 16", function(done) {
				var options = {
					buffer: "/**\n* @name b\n*/var baz = function foo(aa, bb, cc){}", 
					line: '* @name ',
					prefix: "b", 
					offset: 13,
					callback: done};
				testProposals(options, [
				]);
			});
			
			/**
			 * Tests one-line JSDoc completions
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=439574
			 * @since 7.0
			 */
			it("test one-line doc completion", function(done) {
				var options = {
					buffer: "Objects.mixin(Foo.prototype, /** @l  */{});", 
					prefix: "@l",
					line: 'Objects.mixin(Foo.prototype, /** @l  */{});',
					offset: 35,
					templates: true,
					callback: done};
				testProposals(options, [
					 ['', 'Templates'],
				     ['ends ', '@lends - Lends JSDoc tag'],
				     ['icense ', '@license - License JSDoc tag']
				]);
			});
			
			/**
			 * Tests object JSDoc completions
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test object doc completion 1", function(done) {
				var options = {
					buffer: "/**\n* @param {O \n*/", 
					line: '* @param {O ',
					prefix: "O", 
					offset: 15,
					callback: done};
				testProposals(options, [
				  //TODO   ['bject', 'Object', 'Object'],
				]);
			});
			
			/**
			 * Tests object JSDoc completions
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test object doc completion 2", function(done) {
				var options = {
					buffer: "/**\n* @returns {I} \n*/",
					line: '* @returns {I} ',
					prefix: "I", 
					offset: 17,
					callback: done};
				testProposals(options, [
				  //TODO   ['nfinity', 'Infinity', 'Infinity'],
				]);
			});
			
			/**
			 * Tests object JSDoc completions
			 * @see https://bugs.eclipse.org/bugs/show_bug.cgi?id=426185
			 * @since 7.0
			 */
			it("test object doc completion 3", function(done) {
				var options = {
					buffer: "/*eslint-env amd*//**\n* @returns {I} \n*/", 
					line: '* @returns {I} ',
					prefix: "I", 
					offset: 35,
					callback: done};
				testProposals(options, [
				  //TODO   ['mage', 'Image', 'Image'],
				  ///   ['nfinity', 'Infinity', 'Infinity']
				]);
			});
		});
	});
});