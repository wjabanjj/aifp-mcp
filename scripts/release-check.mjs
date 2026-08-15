#!/usr/bin/env node
/**
 * 发布前三边对齐检查（本地 / npm / GitHub）
 *
 * 用法：
 *   node scripts/release-check.mjs
 *
 * 检查项：
 *   1. 本地代码版本号（package.json）
 *   2. npm 上已发布的最新版本号是否一致
 *   3. GitHub 远程 master 是否和本地完全一致
 *   4. 工作区有没有没提交的改动
 *   5. 历史里有没有不该公开的内部文件（AGENTS.md、内网文档、密钥等）
 *
 * 全部通过输出 ✅，有问题输出 ❌ 并指出是哪边没对齐。
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const cwd = resolve(import.meta.dirname, '..')
const run = (cmd) => execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()

// 不该出现在公开历史里的文件（出现即报警）
const SENSITIVE_FILES = [
  'AGENTS.md',
  'docs/服务器接入与密钥分发.md',
  'docs/发布宣传文案.md',
  'benchmark-report.json',
  '新建 文本文档.txt',
]

let ok = true
const fail = (msg) => { ok = false; console.log(`  ❌ ${msg}`) }
const pass = (msg) => console.log(`  ✅ ${msg}`)

console.log('=== aifp-mcp 发布对齐检查 ===\n')

// 1. 本地版本号
const localVersion = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf-8')).version
console.log(`本地 package.json 版本: ${localVersion}`)

// 2. npm 版本
try {
  const npmVersion = run('npm view aifp-mcp version')
  console.log(`npm 已发布版本: ${npmVersion}`)
  if (npmVersion === localVersion) pass('npm 版本对齐')
  else fail(`npm 版本不一致（npm=${npmVersion}，本地=${localVersion}）——需要先 npm publish 或升版本号`)
} catch {
  fail('查不到 npm 版本（网络问题或包不存在）')
}

// 3. 远程 git 是否与本地一致
try {
  const localHead = run('git rev-parse HEAD')
  const remoteHead = run('git ls-remote origin refs/heads/master').split(/\s+/)[0]
  console.log(`本地 HEAD: ${localHead.slice(0, 7)}`)
  console.log(`远程 HEAD: ${remoteHead.slice(0, 7)}`)
  if (localHead === remoteHead) pass('GitHub 远程代码对齐')
  else fail(`GitHub 远程与本地不一致（本地=${localHead.slice(0, 7)}，远程=${remoteHead.slice(0, 7)}）——需要 git push`)
} catch {
  fail('查不到远程状态（网络问题或没配置 remote）')
}

// 4. 工作区是否干净
const status = run('git status --short')
if (!status) pass('工作区干净，没有漏提交')
else {
  fail('工作区有未提交改动：')
  console.log(status.split('\n').map((l) => `      ${l}`).join('\n'))
}

// 5. 历史中的敏感文件
const allObjects = run('git rev-list --all --objects')
for (const f of SENSITIVE_FILES) {
  const found = allObjects.split('\n').filter((l) => l.includes(` ${f}`)).length
  if (found > 0) fail(`历史里还有 ${found} 处 "${f}"——不该公开，需要清理历史`)
}
if (ok) pass('历史干净，无内部文件')

console.log(ok ? '\n🎉 三边全部对齐，可以放心发布' : '\n⚠️ 有未对齐项，先处理再发布')
process.exit(ok ? 0 : 1)
