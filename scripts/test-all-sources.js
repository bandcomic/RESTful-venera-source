// 全量测试脚本：拉取 venera-configs 官方 33 源，逐个验证 4 端点链路
// 用法:
//   node scripts/test-all-sources.js              # 全部源
//   node scripts/test-all-sources.js nhentai      # 单个源
//   node scripts/test-all-sources.js --download   # 仅下载源文件
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CDN = 'https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main';
const INDEX_URL = `${CDN}/index.json`;
const TEST_DIR = process.env.TEST_SOURCES_DIR || path.join(os.tmpdir(), 'vsc-test-sources');
const PORT = parseInt(process.env.TEST_PORT || '3911', 10);

// 各源搜索关键词（按站点特性选择）
const KEYWORDS = {
  copy_manga: ['海贼王'],
  copy_manga_multi_accounts: ['海贼王'],
  komiic: ['solo'],
  baozi: ['海贼王'],
  picacg: ['solo'],
  nhentai: ['misaki'],
  wnacg: ['stella'],
  ehentai: ['stella'],
  jm: ['misaki'],
  manga_dex: ['naruto'],
  ikmmh: ['海贼王'],
  shonen_jump_plus: ['one'],
  hitomi: ['misaki'],
  comick: ['naruto'],
  ykmh: ['海贼王'],
  zaimanhua: ['海贼王'],
  manhuagui: ['海贼王'],
  manwaba: ['海贼王'],
  lanraragi: ['a'],
  komga: ['a'],
  comic_walker: ['one'],
  mh1234: ['海贼王'],
  ccc: ['海贼王'],
  goda: ['海贼王'],
  mh18: ['海贼王'],
  mxs: ['海贼王'],
  manhuaren: ['海贼王'],
  hcomic: ['misaki'],
  jcomic: ['misaki'],
  hot_manga: ['海贼王'],
  kavita: ['a'],
  happy: ['海贼王'],
  mycomic: ['海贼王'],
};

async function httpGet(url, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: `FETCH_ERROR: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadSources() {
  const res = await httpGet(INDEX_URL);
  if (res.status !== 200) {
    throw new Error(`Failed to fetch index: ${res.status}`);
  }
  const list = JSON.parse(res.text);
  fs.mkdirSync(TEST_DIR, { recursive: true });
  for (const item of list) {
    const file = item.fileName;
    const target = path.join(TEST_DIR, file);
    if (fs.existsSync(target)) continue;
    const src = await httpGet(`${CDN}/${file}`, 60000);
    if (src.status === 200) {
      fs.writeFileSync(target, src.text);
      console.log(`  downloaded ${file}`);
    } else {
      console.log(`  FAILED ${file}: ${src.status}`);
    }
  }
  return list;
}

async function runSource(key, serverBase) {
  const result = { key, search: null, detail: null, photo: null, image: null };

  // 1. 搜索
  const kw = (KEYWORDS[key] || ['a'])[0];
  const sRes = await httpGet(`${serverBase}/${encodeURIComponent(key)}/search/${encodeURIComponent(kw)}/1`, 90000);
  let comicId = null;
  if (sRes.status === 200) {
    try {
      const data = JSON.parse(sRes.text);
      result.search = { ok: true, count: data.results ? data.results.length : 0 };
      if (data.results && data.results.length > 0) {
        comicId = data.results[0].comic_id;
      }
    } catch (e) {
      result.search = { ok: false, error: 'bad json' };
    }
  } else {
    result.search = { ok: false, status: sRes.status, error: (() => { try { return JSON.parse(sRes.text).message; } catch { return sRes.text.slice(0, 100); } })() };
  }

  // 2. 详情
  if (comicId) {
    const dRes = await httpGet(`${serverBase}/${encodeURIComponent(key)}/comic/${encodeURIComponent(comicId)}`, 90000);
    if (dRes.status === 200) {
      try {
        const data = JSON.parse(dRes.text);
        result.detail = { ok: true, name: data.name, chapters: data.total_chapters, cover: !!data.cover };
      } catch (e) {
        result.detail = { ok: false, error: 'bad json' };
      }
    } else {
      result.detail = { ok: false, status: dRes.status, error: (() => { try { return JSON.parse(dRes.text).message; } catch { return dRes.text.slice(0, 100); } })() };
    }

    // 3. 章节列表
    if (result.detail && result.detail.ok) {
      const pRes = await httpGet(`${serverBase}/${encodeURIComponent(key)}/photo/${encodeURIComponent(comicId)}/chapter/1`, 90000);
      if (pRes.status === 200) {
        try {
          const data = JSON.parse(pRes.text);
          result.photo = { ok: true, images: data.images ? data.images.length : 0 };
          // 4. 单页图片
          const pageUrl = data.images && data.images.length > 0 ? data.images[0].url : null;
          if (pageUrl) {
            const iRes = await httpGet(`${pageUrl}&ifPNG=1`, 90000);
            result.image = {
              ok: iRes.status === 200 && (iRes.text.length > 1000),
              status: iRes.status,
              bytes: iRes.text.length,
            };
          }
        } catch (e) {
          result.photo = { ok: false, error: 'bad json' };
        }
      } else {
        result.photo = { ok: false, status: pRes.status, error: (() => { try { return JSON.parse(pRes.text).message; } catch { return pRes.text.slice(0, 100); } })() };
      }
    }
  }

  return result;
}

function classify(r) {
  const ok = [r.search && r.search.ok, r.detail && r.detail.ok, r.photo && r.photo.ok, r.image && r.image.ok];
  if (ok.every(Boolean)) return 'OK';
  if (r.search && r.search.ok && !r.detail) return 'SEARCH_ONLY';
  if (r.search && !r.search.ok) return 'SEARCH_FAIL';
  if (r.detail && r.detail.ok && !r.photo) return 'DETAIL_NO_PHOTO';
  return 'PARTIAL';
}

async function main() {
  const filter = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const list = await downloadSources();
  const keys = list.map((i) => i.key);

  if (process.argv.includes('--download')) {
    console.log(`Downloaded ${list.length} sources to ${TEST_DIR}`);
    return;
  }

  // 启动测试服务
  console.log(`Starting test server on port ${PORT} with sources from ${TEST_DIR}`);
  const server = spawn('node', ['server.js', String(PORT)], {
    env: { ...process.env, SOURCES_DIR: TEST_DIR },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(d));
  server.stderr.on('data', (d) => process.stderr.write(d));

  const base = `http://localhost:${PORT}`;
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await httpGet(`${base}/`, 5000);
      ready = res.status === 200;
    } catch (e) { /* retry */ }
  }
  if (!ready) {
    console.error('Test server failed to start');
    server.kill();
    process.exit(1);
  }
  console.log(`Test server ready, testing ${filter ? filter : keys.length} sources...\n`);

  const results = [];
  const targets = filter ? [filter] : keys;
  for (const key of targets) {
    const r = await runSource(key, base);
    results.push(r);
    const cls = classify(r);
    const brief = [
      `search=${r.search && r.search.ok ? 'Y' : 'N'}`,
      `detail=${r.detail && r.detail.ok ? 'Y' : 'N'}`,
      `photo=${r.photo && r.photo.ok ? 'Y' : 'N'}`,
      `image=${r.image && r.image.ok ? 'Y' : 'N'}`,
    ].join(' ');
    const err = (r.image && !r.image.ok ? ` img:${r.image.status}` : '') +
      (r.photo && !r.photo.ok && r.photo.error ? ` photo:${r.photo.error}` : '') +
      (r.detail && !r.detail.ok && r.detail.error ? ` detail:${r.detail.error}` : '') +
      (r.search && !r.search.ok && r.search.error ? ` search:${r.search.error}` : '');
    console.log(`${cls.padEnd(14)} ${key.padEnd(24)} ${brief}${err}`);
  }

  // 汇总
  console.log('\n=== 汇总 ===');
  const ok = results.filter((r) => classify(r) === 'OK');
  const partial = results.filter((r) => classify(r) !== 'OK' && r.search && r.search.ok);
  const fail = results.filter((r) => !r.search || !r.search.ok);
  console.log(`端到端可用: ${ok.map((r) => r.key).join(', ') || '无'}`);
  console.log(`部分可用(详情/章节问题): ${partial.map((r) => r.key).join(', ') || '无'}`);
  console.log(`搜索即失败(登录/验证码/地区/API变动): ${fail.map((r) => r.key).join(', ') || '无'}`);

  server.kill();
  const outFile = '/tmp/vsc-test-results.json';
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n详细结果已写入 ${outFile}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
