var Promise = require('es6-promise').Promise;
    request = require('request'),
    cheerio = require('cheerio'),
    uuid = require('node-uuid'),
    USER_AGENTS = require('../data/useragents.json');

function PayPalError(message, body) {
  var err = new Error(message);
  Object.defineProperty(err, 'name', {
    value: 'PayPalError',
    enumerable: false,
    writable: false,
    configurable: true
  });
  err.body = body;
  return err;
}

function Session (userAgent) {
  if (!(this instanceof Session)) return new Session(userAgent);
  if (!userAgent) userAgent = USER_AGENTS[Math.floor(Math.random()*USER_AGENTS.length)];
  this.userAgent = userAgent;
  this.cookies = request.jar();
}

Session.prototype = {
  request: function (config) {
    if (!config.headers) config.headers = {};
    if (!config.headers['User-Agent'] && !config.headers['user-agent']) config.headers['User-Agent'] = this.userAgent;
    config.jar = this.cookies;
    config.followAllRedirects = true;
    return new Promise(function (resolve, reject) {
      request(config, function (err, resp, body) {
        if (err) reject(err);
        else resolve(resp);
      });
    });
  },
  checkout: function (user, pass, token, cb) {
    var self = this,
        pre,
        buyerId,
        csrf,
        csci = uuid.v4().replace('-', ''),
        corrId = uuid.v1().split('-')[0] + uuid.v4().split('-')[0].substr(0, 5),
        meta;

    var promise = new Promise(function (resolve, reject) {
      function bubble (err) { reject(err); }
      self.request({
        method: 'GET',
        url: 'https://www.paypal.com/checkoutnow',
        qs: {
          token: token
        } 
      }).then(function (v) {
        csrf = v.headers['x-csrf-jwt'];
        var $ = cheerio.load(v.body),
            script = $('script').eq(9).text(),
            parts = /window\.pre\s+=\s+(\{[\s\S]*\})/.exec(script);
        if (parts === null) throw PayPalError('Unexpected response.', v.body);
        try {
          pre = JSON.parse(parts[1]);
        } catch (e) {
          throw PayPalError('JSON parse error.', v.body);
        }
        return self.request({
          method: 'GET',
          url: 'https://www.paypal.com/signin/inject/',
          gzip: true,
          headers: {
            Referer: 'https://www.paypal.com/checkoutnow?token=' + token
          }, 
          qs: {
            stsRedirectUri: 'https://www.paypal.com/checkoutnow/2',
            'country.x': pre.locale.res.data.country,
            'locale.x': pre.locale.res.data.lang + '_' + pre.locale.res.data.country,
            returnUri: 'https://www.paypal.com/checkoutnow/2',
            state: '?flow=1-P&token=' + token,
            forceLogin: 'false',
            flowId: token,
            correlationId: corrId,
            rememberMe: 'true',
            rememberMeContent: '1'
          }
        });
      }, bubble).then(function (v) {
        if (v.headers['x-csrf-jwt']) csrf = v.headers['x-csrf-jwt'];
        var $ = cheerio.load(v.body);
        var lcsrf = $('form[name="login"] input#token').attr('value');
        var session = $('form[name="login"] input#session').attr('value');
        var locale = $('form[name="login"] input[name="locale.x"]').attr('value');
        return self.request({
          method: 'POST',
          url: 'https://www.paypal.com/signin',
          headers: {
            Referer: v.request.uri.href,
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json, text/javascript, */*; q=0.01'
          }, 
          form: {
            _csrf: lcsrf,
            _sessionID: session,
            'locale.x': locale,
            login_email: user,
            login_password: pass
          }
        });
      }, bubble).then(function (v) {
        try {
          var response = JSON.parse(v.body);
        } catch (e) {
          throw PayPalError('Unexpected response from sign-in request.', v.body);
        }
        if (response.notifications) throw PayPalError(response.notifications.msg, v.body);
        meta = {
          token: token,
          calc: pre.checkoutAppData.res.meta.calc,
          csci: csci,
          locale: pre.locale.res.data,
          state: 'ui_checkout_login',
          app_name: 'hermesnodeweb'
        };
        if (v.headers['x-csrf-jwt']) csrf = v.headers['x-csrf-jwt'];
        return self.request({
          method: 'GET',
          url: 'https://www.paypal.com/webapps/hermes/api/auth/securityCtx',
          headers: {
            'x-csrf-jwt': csrf,
            'X-Requested-With': 'XMLHttpRequest',
            Referer: 'https://www.paypal.com/checkoutnow?token=' + token
          },
          qs: {
            meta: JSON.stringify(meta)
          }
        });
      }, bubble).then(function (v) {
        if (v.headers['x-csrf-jwt']) csrf = v.headers['x-csrf-jwt'];
        return self.request({
          method: 'POST',
          url: 'https://www.paypal.com/webapps/hermes/api/checkout/' + token + '/session/create',
          gzip: true,
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8',
            'x-csrf-jwt': csrf,
            Referer: 'https://www.paypal.com/checkoutnow?token=' + token,
            'X-Requested-With': 'XMLHttpRequest'
          },
          json: {
            data: {},
            meta: {
              calc: meta.calc,
              csci: csci,
              app_name: 'hermesnodeweb',
              state: 'ui_checkout_login',
              locale: pre.locale.res.data,
              token: token
            }
          }
        });
      }, bubble).then(function (v) {
        if (v.body.ack !== 'success') throw PayPalError('Hermes session could not be created.', v.body);
        buyerId = v.body.data.payer.id;
        if (v.headers['x-csrf-jwt']) csrf = v.headers['x-csrf-jwt'];
        return self.request({
          method: 'POST',
          url: 'https://www.paypal.com/webapps/hermes/api/checkout/' + token + '/session/authorize',
          headers: {
            'x-csrf-jwt': csrf
          },
          json: {
            meta: {
              app_name: 'hermesnodeweb',
              locale: pre.locale.res.data,
              csci: csci,
              state: 'ui_checkout_review',
              token: token,
              calc: v.body.meta.calc
            }
          }
        });
      }, bubble).then(function (v) {
        var returnUrl = pre.checkoutAppData.res.data.urls.return_url;
        if (v.body.ack !== 'success') throw PayPalError('Could not authorize token with Hermes.', v.body);
        resolve(returnUrl + (~returnUrl.indexOf('?') ? '&' : '?') + 'PayerID=' + buyerId);
      }, bubble);
    });
    if (typeof cb !== 'function') return promise;
    promise.then(function (v) {
      cb(null, v);
    }, function (err) {
      cb(err);
    });
  }
};

module.exports = function checkout (user, pass, token, cb) {
  return Session().checkout(user, pass, token, cb);
};
