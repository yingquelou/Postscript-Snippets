import { restoreManifest } from './manifest.js'

// manual reset: `npm run restore:manifest`
const result = restoreManifest()
console.log(result.changed ? `package.json: ${result.reason}` : `package.json unchanged (${result.reason})`)
