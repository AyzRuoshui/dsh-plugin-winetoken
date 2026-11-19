// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

test('CanvasXyFlowBundle - 独立子进程 probe 成功解构出全部组件与样式', () => {
  const code = `
    const path = require('path');
    const React = require('react');
    const ReactDOM = require('react-dom');
    const factoryPath = path.join('${__dirname}', '..', 'src', 'vendor', 'xyflow.factory.cjs');
    const factoryMod = require(factoryPath);
    const init = factoryMod.default || factoryMod;
    if (typeof init !== 'function') {
      console.error('PROBE_FAIL: init is not a function');
      process.exit(1);
    }
    const instance = init(React, ReactDOM);
    const requiredKeys = [
      'ReactFlow', 'MiniMap', 'Controls', 'Background',
      'Handle', 'Position', 'Panel',
      'applyNodeChanges', 'applyEdgeChanges', 'addEdge', 'cssText'
    ];
    for (const k of requiredKeys) {
      if (instance[k] === undefined || instance[k] === null) {
        console.error('PROBE_FAIL: missing key ' + k);
        process.exit(1);
      }
    }
    if (typeof instance.cssText !== 'string' || instance.cssText.length < 500) {
      console.error('PROBE_FAIL: cssText is invalid');
      process.exit(1);
    }
    if (!instance.cssText.includes('.react-flow')) {
      console.error('PROBE_FAIL: cssText missing .react-flow prefix');
      process.exit(1);
    }
    console.log('BUNDLE_PROBE_OK');
  `;

  const out = execFileSync(process.execPath, ['-e', code], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10000
  });

  assert.match(out, /BUNDLE_PROBE_OK/);
});

test('CanvasXyFlowBundle - 内嵌 CSS 可被 DOM 桩消费且支持 SSR 容器渲染', () => {
  const React = require('react');
  const ReactDOMServer = require('react-dom/server');
  const initXyFlow = require('../src/vendor/xyflow.factory.cjs');
  const { ReactFlow, ReactFlowProvider, cssText } = initXyFlow(React);

  // DOM 桩消费样式
  const fakeElement = { id: '', textContent: '' };
  fakeElement.id = 'winetoken-xyflow-style';
  fakeElement.textContent = cssText;
  assert.equal(fakeElement.id, 'winetoken-xyflow-style');
  assert.ok(fakeElement.textContent.includes('.react-flow'));

  // SSR 容器渲染测试，隐藏归属徽章
  const element = React.createElement(
    ReactFlowProvider,
    null,
    React.createElement(ReactFlow, {
      nodes: [{ id: '1', position: { x: 0, y: 0 }, data: { label: 'Node 1' } }],
      edges: [],
      proOptions: { hideAttribution: true }
    })
  );

  const html = ReactDOMServer.renderToString(element);
  assert.ok(typeof html === 'string' && html.length > 0);
  assert.ok(html.includes('react-flow'));
});
