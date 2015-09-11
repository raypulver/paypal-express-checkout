var expect = require('chai').expect;
var checkout = require('../');
var PAYPAL_USER = process.env.PAYPAL_USER,
    PAYPAL_PASS = process.env.PAYPAL_PASS,
    PAYPAL_TOKEN = process.env.PAYPAL_TOKEN;

describe('paypal express checkout module', function () {
  this.timeout(30000);
  it('should authorize the transaction without an error', function (done) {
    checkout(PAYPAL_USER, PAYPAL_PASS, PAYPAL_TOKEN).then(function (v) {
      expect(/http/.test(v)).to.be.true;
      done();
    }, function (e) {
      expect(true).to.be.false;
      done();
    });
  });
});
