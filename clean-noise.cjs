// AiFP 记忆库噪音清理 v2：删 <summary>/<task-id> 噪音 + 孤儿关联 + 重建 FTS5 索引
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.ai-cognition/cognition.db');
db.exec('PRAGMA busy_timeout = 5000');

const before = db.prepare('SELECT COUNT(*) c FROM memories').get().c;
const noise = db.prepare(
  "SELECT id FROM memories WHERE content LIKE '<summary>%' OR content LIKE '<task-id>%'"
).all().map(r => r.id);
console.log('待删除噪音:', noise.length, '/', before);

db.exec('BEGIN');

// 1. 噪音 id 入临时表
db.exec('DROP TABLE IF EXISTS _noise_tmp');
db.exec('CREATE TEMP TABLE _noise_tmp (id TEXT PRIMARY KEY)');
const ins = db.prepare('INSERT OR IGNORE INTO _noise_tmp (id) VALUES (?)');
for (const id of noise) ins.run(id);

// 2. DROP 删除触发器（有问题的），删除噪音
db.exec('DROP TRIGGER IF EXISTS memories_fts5_delete');
const r1 = db.prepare('DELETE FROM memories WHERE id IN (SELECT id FROM _noise_tmp)').run();
console.log('memories 删除:', r1.changes);

// 3. 清孤儿关联
for (const [table, cols] of [
  ['memory_associations', ['mem_a', 'mem_b']],
  ['causal_links', ['source_id', 'target_id']],
  ['perception_links', ['source_id', 'target_id']],
]) {
  try {
    const conds = cols.map(c => `${c} IN (SELECT id FROM _noise_tmp)`).join(' OR ');
    const r = db.prepare(`DELETE FROM ${table} WHERE ${conds}`).run();
    if (r.changes > 0) console.log(`  ${table}: 清理 ${r.changes} 条孤儿引用`);
  } catch (e) { /* 表可能不存在 */ }
}

// 4. 重建 FTS5 表 + 触发器（保证索引与数据一致）
db.exec('DROP TRIGGER IF EXISTS memories_fts5_insert');
db.exec('DROP TRIGGER IF EXISTS memories_fts5_update');
db.exec('DROP TABLE IF EXISTS memories_fts5');
db.exec(`CREATE VIRTUAL TABLE memories_fts5 USING fts5(
  content, detail, title, tags, mem_id,
  tokenize='unicode61'
)`);
db.exec(`
  CREATE TRIGGER memories_fts5_insert AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts5(rowid, content, detail, title, tags, mem_id)
    VALUES (new.rowid, new.content, new.detail, new.title, new.tags, new.mem_id);
  END
`);
db.exec(`
  CREATE TRIGGER memories_fts5_delete AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts5(memories_fts5, rowid) VALUES ('delete', old.rowid);
  END
`);
db.exec(`
  CREATE TRIGGER memories_fts5_update AFTER UPDATE ON memories WHEN
    old.content IS NOT new.content OR
    old.detail IS NOT new.detail OR
    old.title IS NOT new.title OR
    old.tags IS NOT new.tags OR
    old.mem_id IS NOT new.mem_id
  BEGIN
    INSERT OR REPLACE INTO memories_fts5(rowid, content, detail, title, tags, mem_id)
    VALUES (new.rowid, new.content, new.detail, new.title, new.tags, new.mem_id);
  END
`);
// 全量重灌 FTS5
db.exec(`
  INSERT INTO memories_fts5(rowid, content, detail, title, tags, mem_id)
  SELECT rowid, content, detail, title, tags, mem_id FROM memories
`);

db.exec('COMMIT');
db.exec('DROP TABLE _noise_tmp');

const after = db.prepare('SELECT COUNT(*) c FROM memories').get().c;
const fts = db.prepare('SELECT COUNT(*) c FROM memories_fts5').get().c;
console.log(`完成: ${before} → ${after} 条记忆, FTS5 索引 ${fts} 条, 一致=${after === fts}`);
