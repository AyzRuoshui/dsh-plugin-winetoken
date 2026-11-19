import * as XyFlow from '@xyflow/react';
import cssText from '@xyflow/react/dist/style.css';

function initXyFlow(React, ReactDOM) {
  if (React && typeof globalThis !== 'undefined' && !globalThis.React) {
    try { globalThis.React = React; } catch (_) {}
  }
  return { ...XyFlow, cssText };
}

module.exports = initXyFlow;
module.exports.default = initXyFlow;
module.exports.initXyFlow = initXyFlow;
