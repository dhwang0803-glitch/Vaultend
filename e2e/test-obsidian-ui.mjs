/**
 * Obsidian Plugin E2E UI Test
 * Obsidian을 --remote-debugging-port로 실행하고 Playwright CDP로 연결한다.
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const OBSIDIAN_PATH = 'C:\\Users\\daewo\\AppData\\Local\\Programs\\Obsidian\\Obsidian.exe';
const DEBUG_PORT = 9222;
const RESULTS = [];

function pass(name) { RESULTS.push({ name, status: 'PASS' }); console.log(`  ✅ ${name}`); }
function fail(name, err) { RESULTS.push({ name, status: 'FAIL', error: String(err) }); console.log(`  ❌ ${name}: ${err}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForDebugger(port, maxWait = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return true;
    } catch { /* retry */ }
    await sleep(1000);
  }
  return false;
}

async function main() {
  console.log('🚀 Obsidian 실행 중 (debug port:', DEBUG_PORT, ')...');

  // Obsidian을 debug port와 함께 실행
  const obsidian = spawn(OBSIDIAN_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
    detached: true,
    stdio: 'ignore',
  });
  obsidian.unref();

  // debugger 포트 대기
  console.log('  CDP 포트 대기 중...');
  const ready = await waitForDebugger(DEBUG_PORT);
  if (!ready) {
    console.error('❌ Obsidian debug port에 연결 실패');
    process.exit(1);
  }
  console.log('  CDP 연결 성공!');

  // Obsidian 초기화 대기
  await sleep(8000);

  // Playwright CDP 연결
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  const contexts = browser.contexts();
  const page = contexts[0]?.pages()[0];

  if (!page) {
    console.error('❌ Obsidian 페이지를 찾을 수 없음');
    await browser.close();
    process.exit(1);
  }

  // 스크린샷
  await page.screenshot({ path: 'e2e/screenshot-initial.png' });
  console.log('  초기 스크린샷: e2e/screenshot-initial.png');

  console.log('\n📋 UI 테스트 시작\n');

  // --- Test 1: 윈도우 확인 ---
  try {
    const title = await page.title();
    console.log(`  Window title: "${title}"`);
    pass('Obsidian 윈도우 열림');
  } catch (e) { fail('Obsidian 윈도우 열림', e); }

  // --- Test 2: Settings 열기 (Ctrl+,) ---
  try {
    await page.keyboard.press('Control+,');
    await sleep(1500);
    await page.screenshot({ path: 'e2e/screenshot-settings.png' });

    const settingsModal = page.locator('.modal-container');
    const visible = await settingsModal.isVisible();
    if (visible) pass('Settings 모달 열림');
    else fail('Settings 모달 열림', 'modal not visible');
  } catch (e) { fail('Settings 모달 열림', e); }

  // --- Test 3: Vaultend 설정 탭 ---
  try {
    const pluginTab = page.locator('.vertical-tab-nav-item', { hasText: 'Vaultend' });
    const exists = await pluginTab.count();
    if (exists > 0) {
      pass('Vaultend 설정 탭 존재');
      await pluginTab.click();
      await sleep(500);
      await page.screenshot({ path: 'e2e/screenshot-plugin-settings.png' });

      const content = await page.locator('.vertical-tab-content').textContent();

      const checks = [
        ['AI 공급자', 'AI 공급자 설정'],
        ['정리', '정리 설정'],
        ['유지보수', '유지보수 설정'],
        ['프라이버시', '프라이버시 설정'],
      ];
      for (const [keyword, label] of checks) {
        if (content.includes(keyword)) pass(label);
        else fail(label, `"${keyword}" not found`);
      }
    } else {
      fail('Vaultend 설정 탭 존재', 'tab not found — plugin may not be enabled');
    }
  } catch (e) { fail('Vaultend 설정 탭', e); }

  // Settings 닫기
  await page.keyboard.press('Escape');
  await sleep(500);

  // --- Test 4: Command Palette ---
  try {
    await page.keyboard.press('Control+p');
    await sleep(1000);
    await page.keyboard.type('Vaultend', { delay: 30 });
    await sleep(800);
    await page.screenshot({ path: 'e2e/screenshot-commands.png' });

    const suggestions = await page.locator('.suggestion-item').count();
    if (suggestions >= 5) pass(`Command Palette: ${suggestions}개 커맨드`);
    else fail('Command Palette 커맨드 수', `expected >=5, got ${suggestions}`);

    const content = await page.locator('.prompt-results').textContent();
    const commands = ['Quick Ask', '폴더 정리', '유지보수 실행', '현재 노트 정리', '유지보수 로그'];
    for (const cmd of commands) {
      if (content.includes(cmd)) pass(`커맨드: "${cmd}"`);
      else fail(`커맨드: "${cmd}"`, 'not found');
    }

    await page.keyboard.press('Escape');
    await sleep(300);
  } catch (e) { fail('Command Palette', e); }

  // --- Test 5: Quick Ask 모달 ---
  try {
    await page.keyboard.press('Control+p');
    await sleep(500);
    await page.keyboard.type('Quick Ask', { delay: 30 });
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1500);
    await page.screenshot({ path: 'e2e/screenshot-quickask.png' });

    const modal = page.locator('.vaultend-quick-ask');
    if (await modal.count() > 0) {
      pass('Quick Ask 모달 열림');
      if (await modal.locator('textarea').count() > 0) pass('Quick Ask 텍스트 입력란');
      else fail('Quick Ask 텍스트 입력란', 'textarea not found');
      if (await modal.locator('button').count() > 0) pass('Quick Ask 버튼');
      else fail('Quick Ask 버튼', 'button not found');
    } else {
      fail('Quick Ask 모달 열림', 'modal not found');
    }
    await page.keyboard.press('Escape');
    await sleep(300);
  } catch (e) { fail('Quick Ask 모달', e); }

  // --- Test 6: Maintenance Log 뷰 ---
  try {
    await page.keyboard.press('Control+p');
    await sleep(500);
    await page.keyboard.type('유지보수 로그', { delay: 30 });
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(2000);
    await page.screenshot({ path: 'e2e/screenshot-log.png' });

    const logView = page.locator('.workspace-leaf-content', { hasText: '유지보수' });
    if (await logView.count() > 0) pass('Maintenance Log 뷰 열림');
    else fail('Maintenance Log 뷰 열림', 'view not found');
  } catch (e) { fail('Maintenance Log 뷰', e); }

  // --- 결과 요약 ---
  console.log('\n' + '='.repeat(50));
  const passed = RESULTS.filter(r => r.status === 'PASS').length;
  const failed = RESULTS.filter(r => r.status === 'FAIL').length;
  console.log(`\n📊 결과: ${passed} passed, ${failed} failed (total ${RESULTS.length})`);

  if (failed > 0) {
    console.log('\n❌ 실패 항목:');
    for (const r of RESULTS.filter(r => r.status === 'FAIL')) {
      console.log(`   - ${r.name}: ${r.error}`);
    }
  }

  await browser.close();
  // Obsidian 프로세스 종료
  try { process.kill(-obsidian.pid); } catch { /* already exited */ }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
