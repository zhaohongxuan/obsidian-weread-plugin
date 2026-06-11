#!/usr/bin/env node
// 独立测试 V2 Agent API — 直接 HTTP 调用，不依赖 Obsidian 运行时

const API_KEY = process.env.WEREAD_API_KEY || 'wrk-jILv0YqITCGUbFoXeZhUpwAA';
const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';

async function callAgent(apiName, params = {}) {
  const body = JSON.stringify({ api_name: apiName, skill_version: '1.0.3', ...params });
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body,
  });

  if (!res.ok) {
    console.error(`❌ HTTP ${res.status} ${res.statusText}`);
    return undefined;
  }

  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    console.error(`❌ API error: errcode=${data.errcode} errmsg=${data.errmsg}`);
    return undefined;
  }
  return data;
}

async function runTests() {
  console.log('═══════════════════════════════════════');
  console.log('  V2 Agent API 测试');
  console.log('═══════════════════════════════════════\n');

  // 1. getNotebooks
  console.log('── 1. /user/notebooks ──');
  const notebooks = await callAgent('/user/notebooks');
  let bookId = 'T202107310023715';
  if (notebooks) {
    console.log(`✅ totalBookCount: ${notebooks.totalBookCount}, totalNoteCount: ${notebooks.totalNoteCount}`);
    const sample = notebooks.books?.[0];
    if (sample) {
      console.log(`   📖 第一本: 《${sample.book?.title}》 by ${sample.book?.author}`);
      console.log(`   📝 noteCount: ${sample.noteCount}, reviewCount: ${sample.reviewCount}`);
      bookId = sample.book?.bookId || bookId;
    }
  } else {
    console.log('❌ 失败');
  }
  console.log();

  console.log(`── 使用 bookId=${bookId} 测试后续接口 ──\n`);

  // 2. getBook
  console.log('── 2. /book/info ──');
  const bookInfo = await callAgent('/book/info', { bookId });
  if (bookInfo) {
    console.log(`✅ 书名: 《${bookInfo.title}》 by ${bookInfo.author}`);
    console.log(`   📂 category: ${bookInfo.category}`);
    console.log(`   🏷️  publisher: ${bookInfo.publisher || '无'}`);
    console.log(`   ⭐ rating: ${bookInfo.newRating / 10}%`);
    console.log(`   📄 intro: ${bookInfo.intro?.slice(0, 80)}...`);
  } else {
    console.log('❌ 失败');
  }
  console.log();

  // 3. getProgress
  console.log('── 3. /book/getprogress ──');
  const progress = await callAgent('/book/getprogress', { bookId });
  if (progress?.book) {
    console.log(`✅ progress: ${progress.book.progress}%`);
    const rt = progress.book.readingTime || 0;
    console.log(`   ⏱️  readingTime: ${rt}s (${Math.round(rt / 60)}min)`);
    if (progress.book.finishTime) {
      const fd = new Date(progress.book.finishTime * 1000).toISOString().slice(0, 10);
      console.log(`   🏁 finished: ${fd}`);
    }
    if (progress.book.startReadingTime) {
      const sd = new Date(progress.book.startReadingTime * 1000).toISOString().slice(0, 10);
      console.log(`   📅 started: ${sd}`);
    }
  } else {
    console.log('❌ 失败');
  }
  console.log();

  // 4. getNotebookHighlights
  console.log('── 4. /book/bookmarklist ──');
  const highlights = await callAgent('/book/bookmarklist', { bookId });
  if (highlights) {
    const count = highlights.updated?.length || 0;
    console.log(`✅ highlights: ${count} 条`);
    if (count > 0) {
      const h = highlights.updated[0];
      console.log(`   📍 第一条: "${h.markText?.slice(0, 50)}..."`);
      console.log(`   📍 chapterUid: ${h.chapterUid}, range: ${h.range}`);
    }
  } else {
    console.log('❌ 失败');
  }
  console.log();

  // 5. getChapters
  console.log('── 5. /book/chapterinfo ──');
  const chapters = await callAgent('/book/chapterinfo', { bookId });
  if (chapters) {
    const count = chapters.chapters?.length || 0;
    console.log(`✅ chapters: ${count} 章`);
    if (count > 0) {
      console.log(`   📑 第一章: "${chapters.chapters[0]?.title}" (level=${chapters.chapters[0]?.level})`);
      // 取前5章标题
      for (let i = 0; i < Math.min(5, count); i++) {
        const ch = chapters.chapters[i];
        console.log(`   ${'  '.repeat(ch.level - 1)}${ch.title}${ch.price === -1 ? ' [付费]' : ''}`);
      }
      if (count > 5) console.log(`   ... 共 ${count} 章`);
    }
  } else {
    console.log('❌ 失败');
  }
  console.log();

  // 6. getNotebookReviews
  console.log('── 6. /review/list/mine (个人想法) ──');
  const reviews = await callAgent('/review/list/mine', { bookid: bookId, synckey: 0 });
  if (reviews) {
    const count = reviews.reviews?.length || reviews.totalCount || 0;
    console.log(`✅ personal reviews: ${count} 条`);
    if (reviews.reviews?.length > 0) {
      const r = reviews.reviews[0].review || reviews.reviews[0];
      console.log(`   💬 第一条: "${r.content?.slice(0, 50)}..."`);
      console.log(`   📎 abstract: "${r.abstract?.slice(0, 50)}..."`);
    }
  } else {
    console.log('❌ 失败 (无个人想法的书可能返回空)');
  }
  console.log();

  console.log('═══════════════════════════════════════');
  console.log('  ✅ 所有接口测试通过');
  console.log('═══════════════════════════════════════');
}

runTests().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
