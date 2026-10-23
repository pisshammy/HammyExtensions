// `chai` is a transitive dependency of the paperback toolchain and ships no
// types. The vendored test runner only uses `expect(...)`, so an ambient
// declaration is enough to keep `tsconfig.tests.json` clean.
declare module 'chai'
