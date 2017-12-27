const _ = require('lodash');
const checker = require('istanbul-threshold-checker');

function Validator(thresholds) {
  this.thresholds = thresholds || {};
}

Validator.prototype.validate = function(collector) {
  let finalCoverage = collector.getFinalCoverage();
  let results = checker.checkFailures(this.thresholds, finalCoverage);

  const thresholdMet = function(coverage) {
    let thresholdMet = true;
    let expectedValue;

    if (coverage.global && coverage.global.failed) {
      expectedValue = this.thresholds['global'][coverage.type] || this.thresholds['global']

      console.log('Coverage for ' + coverage.type +
        ' ('  + coverage.global.value + '%)' +
        ' does not meet configured threshold (' +
        expectedValue + '%) ');
      thresholdMet = false;
    }

    if (coverage.each && coverage.each.failed) {
      expectedValue = this.thresholds['each'][coverage.type] || this.thresholds['each']

      console.log('Coverage threshold (' +
        expectedValue + '%) ' + 'not met for ' +
        coverage.type + ' in files: \n  ' +
        coverage.each.failures.join('\n  '));
      thresholdMet = false;
    }

    return thresholdMet;
  }.bind(this);

  return _.chain(results)
    .map(thresholdMet)
    .reduce(function(memo, valid) { return memo && valid; }, true)
    .value();
}

module.exports = Validator;