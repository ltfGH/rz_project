(function (global) {
  'use strict';

  global.AppDomain = {
    createInitialState: function (demoData) {
      return { records: demoData.records.slice() };
    }
  };
}(window));
