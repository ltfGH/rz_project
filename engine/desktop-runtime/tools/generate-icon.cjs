'use strict';

const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Database } = require('lucide-react');

const icon = React.createElement(
  'svg',
  { xmlns: 'http://www.w3.org/2000/svg', width: 512, height: 512, viewBox: '0 0 512 512' },
  React.createElement('rect', { width: 512, height: 512, rx: 88, fill: '#176b63' }),
  React.createElement(Database, {
    x: 96,
    y: 96,
    width: 320,
    height: 320,
    color: '#ffffff',
    strokeWidth: 1.8,
    'aria-hidden': 'true'
  })
);
const output = path.resolve(__dirname, '..', 'build', 'icon.svg');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(icon)}\n`, 'utf8');
