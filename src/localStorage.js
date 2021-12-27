import isNode from 'is-node';

export let localStorage = null;

// tests if global scope is bound to "global"
if (isNode) {
  // eslint-disable-next-line no-undef
  localStorage = require('localStorage');
} else {
  localStorage = window.localStorage;
}
