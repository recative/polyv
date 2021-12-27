import isNode from 'is-node';

export let fetch = null;

// tests if global scope is bound to "global"
if (isNode) {
  // eslint-disable-next-line no-undef
  fetch = require('node-fetch');
} else {
  fetch = window.fetch;
}
