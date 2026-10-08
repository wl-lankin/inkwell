'use strict';

// electron-builder configuration. The shared settings live in package.json ("build").
// macOS signing depends on the environment:
// - CSC_LINK set (Developer ID certificate) -> sign with hardened runtime and notarize with Apple,
//   so Gatekeeper opens Inkwell without warnings.
// - otherwise -> ad-hoc signature, which runs but needs a one-time "Open Anyway" on each Mac.

const base = require('./package.json').build;

const developerId = !!process.env.CSC_LINK;
const notarize = developerId && !!process.env.APPLE_API_KEY && !!process.env.APPLE_API_KEY_ID && !!process.env.APPLE_API_ISSUER;

module.exports = {
  ...base,
  mac: {
    ...base.mac,
    ...(developerId
      ? {
          hardenedRuntime: true,
          entitlements: 'build/entitlements.mac.plist',
          entitlementsInherit: 'build/entitlements.mac.plist',
          notarize,
        }
      : {
          identity: '-',
          hardenedRuntime: false,
          notarize: false,
        }),
  },
};
