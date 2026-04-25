const fs = require('fs')
const path = require('path')

const dirs = ['dist', 'snippets.gen']

dirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    console.log('Removed:', dir)
  }
})