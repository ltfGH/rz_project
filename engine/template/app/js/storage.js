(function (global) {
  'use strict';

  var prefix = 'generated-software:';

  global.AppStorage = {
    load: function (key, fallback) {
      var value = global.localStorage.getItem(prefix + key);
      return value === null ? fallback : JSON.parse(value);
    },
    save: function (key, value) {
      global.localStorage.setItem(prefix + key, JSON.stringify(value));
      return value;
    },
    reset: function (key) {
      global.localStorage.removeItem(prefix + key);
    }
  };
}(window));
