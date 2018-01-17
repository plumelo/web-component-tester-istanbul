const express = require('express');
const istanbul = require('istanbul');
const path = require('path');

const middleware = require('./middleware');
const Validator = require('./validator');
const sync = true;

/**
* Tracks coverage objects and writes results by listening to events
* emitted from wct test runner.
*/

/**
 * Plugin compatible with the version 6.4.x of web-component-tester
 */

function Listener (emitter, pluginOptions) {

  this.options = pluginOptions;
  this.collector = new istanbul.Collector();
  this.reporter = new istanbul.Reporter(false, path.join(emitter.options.root || process.cwd(), this.options.dir));
  this.validator = new Validator(this.options.thresholds);
  this.reporter.addAll(this.options.reporters);

  emitter.on('sub-suite-end', function(browser, data) {
    if (data && data.__coverage__) {
      this.collector.add(data.__coverage__);
    }
  }.bind(this));

  emitter.on('run-end', function(error) {
    // Get files with no coverage and that matches with the options include pattern
    const cvgAll = middleware.getFilesNotCoveraged(emitter.options.root, this.options);
    cvgAll.forEach(
      data => {
        this.collector.add(data);
      }
    );

    // Clear middleware cache
    middleware.cacheClear();

    if (!error) {
      // Log a new line to not overwrite the test results outputted by WCT
      console.log('\n');
      this.reporter.write(this.collector, sync, function() {});

      if (!validator.validate(this.collector)) {
        throw new Error('Coverage failed');
      }
    }
  }.bind(this));

  emitter.hook('define:webserver', function (app, replacePolyserveApp, wctOptions, done) {
    var instrumentedApp = express();
    instrumentedApp.use(middleware.middleware(emitter.options.root, this.options, wctOptions, emitter));
    instrumentedApp.use(app);
    replacePolyserveApp(instrumentedApp);
    done();
  }.bind(this));

};

module.exports = Listener;
