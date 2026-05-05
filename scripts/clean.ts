import * as fs from 'fs'
if (process.argv.length > 2) {
  process.argv.slice(2).forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      console.log('Removed:', dir)
    }
  })
}