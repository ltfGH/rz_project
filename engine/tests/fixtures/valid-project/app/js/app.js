(function () {
  var labels = {
    dashboard: 'Inspection Dashboard',
    records: 'Equipment Records',
    operation: 'Run Inspection',
    history: 'Inspection History'
  };

  function render() {
    var route = location.hash.slice(1) || 'dashboard';
    var title = labels[route] || labels.dashboard;
    document.getElementById('app').innerHTML =
      '<div class="toolbar"><h2>' + title + '</h2><button>New record</button></div>' +
      '<section class="stats">' +
        '<div class="stat">Equipment<strong>36</strong></div>' +
        '<div class="stat">Due today<strong>8</strong></div>' +
        '<div class="stat">Completion<strong>92%</strong></div>' +
      '</section>' +
      '<section class="panel"><table><thead><tr><th>Asset</th><th>Area</th><th>Status</th></tr></thead>' +
      '<tbody><tr><td>Pump A-104</td><td>Workshop 1</td><td><span class="badge">Normal</span></td></tr>' +
      '<tr><td>Meter B-208</td><td>Workshop 2</td><td><span class="badge">Normal</span></td></tr>' +
      '<tr><td>Valve C-312</td><td>Warehouse</td><td><span class="badge">Normal</span></td></tr></tbody></table></section>';
  }

  window.generatedProject = true;
  window.addEventListener('hashchange', render);
  render();
}());
