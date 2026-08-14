const fs = require('fs')
const path = require('path')
const dir = 'E:\\Down\\AiFP 记忆感知系统\\src'
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'))
const map = {}
files.forEach(f => map[f.replace('.ts','')] = 0)
for (const f of files) {
  const c = fs.readFileSync(path.join(dir, f), 'utf8')
  for (const b of Object.keys(map)) {
    const re = new RegExp("from\\s*['\"]\\./" + b + "(?:\\.js)?['\"]")
    if (re.test(c) && f !== b + '.ts') map[b]++
  }
}
Object.entries(map).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(v + '\t' + k + '.ts'))
