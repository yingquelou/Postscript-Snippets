const fs = require('fs')
fs.readFile(
    'package.json',
    (err, data) => {
        if (err) throw err
        const obj = JSON.parse(data)
        delete obj.contributes.snippets
        fs.writeFile('package.json', JSON.stringify(obj,null,'\t'), err => {
            if (err) throw err
        })
    },
)