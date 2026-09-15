(function (global, document) {
  'use strict';

  var state = global.AppStorage.load(
    'state',
    global.AppDomain.createInitialState(global.AppDemoData)
  );
  var app = document.getElementById('app');
  app.textContent = state.records.length ? '' : '暂无数据';
}(window, document));
