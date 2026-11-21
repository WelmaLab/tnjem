/* Preloaded by `npm run test` (tsx --import). The API treats an unset NODE_ENV as
   production (src/env.ts); unit tests run under "development" unless told otherwise.
   Not "test": the sign-in tests read the on-screen login code (devCode), and since
   VULN-008 that is shown only when NODE_ENV is exactly "development". */
process.env.NODE_ENV ||= "development";
