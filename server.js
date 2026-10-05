// Compatibility launcher; business logic lives in the TypeScript core.
// Old JS deployments used display names as source keys. Keep that catalog when
// this compatibility launcher is used, including its old query-based routes.
process.env.LEGACY_SOURCE_KEYS = process.env.LEGACY_SOURCE_KEYS || '1'
const { createServer } = require('./dist/server.js')
createServer().then(server => server.listen({port:Number(process.env.PORT || process.argv[2] || 3000),host:'0.0.0.0'}))
  .catch(error => { console.error(error); process.exit(1) })
