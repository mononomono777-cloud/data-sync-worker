const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ========== Supabase ==========
let supabase = null;
const FORCE_FULL = process.argv.includes('--force-full');
try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        if (FORCE_FULL) {
            console.log('[全件モード] --force-full 指定。差分チェックをスキップします。');
        } else {
            console.log('[差分モード] Supabase接続あり — 既存データとの差分のみ取得します。');
        }
    } else {
        console.log('[全件モード] Supabase未設定 — 全データを取得します。');
    }
} catch (e) {
    console.log('[全件モード] Supabaseモジュール読み込み失敗 — 全データを取得します。');
}

// ========== 対象SIDの取得 ==========
/**
 * Supabase の subscriptions テーブルからアクティブな Short ID 一覧を取得。
 * Supabase 未接続時は環境変数 TARGET_SIDS にフォールバック。
 */
async function getTargetSids() {
    // Supabase から動的取得
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('subscriptions')
                .select('short_id')
                .eq('is_active', true);
            if (error) throw new Error(error.message);
            const sids = [...new Set(data.map(r => r.short_id))]; // 重複排除
            if (sids.length > 0) {
                console.log(`[subscriptions] ${sids.length}件のアクティブなSIDを取得しました。`);
                return sids;
            }
            console.warn('[subscriptions] アクティブなSIDがありません。環境変数にフォールバック。');
        } catch (e) {
            console.warn(`[subscriptions] 取得エラー: ${e.message}。環境変数にフォールバック。`);
        }
    }

    // フォールバック: 環境変数
    const envSids = (process.env.TARGET_SIDS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (envSids.length === 0) {
        console.error("対象SIDが見つかりません。subscriptions テーブルまたは環境変数 TARGET_SIDS を設定してください。");
        process.exit(1);
    }
    console.log(`[TARGET_SIDS] 環境変数から ${envSids.length}件のSIDを取得しました。`);
    return envSids;
}

// ========== 設定 ==========
const ACT_RANGE = Array.from({ length: 12 }, (_, i) => i); // Act 0 ~ 11
const STORAGE_STATE_PATH = path.join(__dirname, 'storageState.json');
const BUCKLER_BASE = 'https://www.streetfighter.com/6/buckler';

// ========== ユーティリティ ==========
function sleep(ms) {
    const randomMs = ms + Math.random() * 1500;
    return new Promise(resolve => setTimeout(resolve, randomMs));
}

function hasStorageState() {
    return fs.existsSync(STORAGE_STATE_PATH);
}

// ========== Supabase 差分チェック用 ==========

/**
 * Supabase から既存の act_id 一覧を取得（is_current = false のもの）
 * @returns {Set<number>} 取得済みの act_id のセット
 */
async function getExistingActIds(shortId) {
    if (!supabase || FORCE_FULL) return new Set();
    try {
        const { data, error } = await supabase
            .from('act_history')
            .select('act_id')
            .eq('short_id', shortId)
            .eq('is_current', false);
        if (error) {
            console.warn(`  [WARN] act_history 取得エラー: ${error.message}`);
            return new Set();
        }
        const ids = new Set(data.map(r => r.act_id));
        return ids;
    } catch (e) {
        console.warn(`  [WARN] act_history 取得例外: ${e.message}`);
        return new Set();
    }
}

/**
 * Supabase から既存の replay_id 一覧を取得
 * @returns {Set<string>} 取得済みの replay_id のセット
 */
async function getExistingReplayIds(shortId) {
    if (!supabase || FORCE_FULL) return new Set();
    try {
        const { data, error } = await supabase
            .from('battle_log')
            .select('replay_id')
            .eq('short_id', shortId);
        if (error) {
            console.warn(`  [WARN] battle_log 取得エラー: ${error.message}`);
            return new Set();
        }
        return new Set(data.map(r => r.replay_id));
    } catch (e) {
        console.warn(`  [WARN] battle_log 取得例外: ${e.message}`);
        return new Set();
    }
}

// ========== バトルログ関連ヘルパー ==========
function formatControlType(typeName) {
    if (!typeName) return 'Unknown';
    if (typeName.toLowerCase().includes('classic') || typeName.includes('クラシック')) return 'Classic';
    if (typeName.toLowerCase().includes('modern') || typeName.includes('モダン')) return 'Modern';
    return typeName;
}

function parseBattleLogFromPage(nextData) {
    const battles = [];
    try {
        const replayList = nextData.props?.pageProps?.replay_list;
        if (!replayList || !Array.isArray(replayList)) return battles;

        replayList.forEach(match => {
            try {
                const p1 = match.player1_info;
                const p2 = match.player2_info;
                const p1Rounds = Array.isArray(p1.round_results) ? p1.round_results : [];
                const p2Rounds = Array.isArray(p2.round_results) ? p2.round_results : [];
                const p1Score = p1Rounds.filter(r => r > 0).length;
                const p2Score = p2Rounds.filter(r => r > 0).length;

                battles.push({
                    date: new Date(match.uploaded_at * 1000).toISOString(),
                    timestamp: match.uploaded_at * 1000,
                    p1Name: p1.player.fighter_id,
                    p1Id: String(p1.player.short_id),
                    p1Character: p1.playing_character_name,
                    p1Type: formatControlType(p1.battle_input_type_name),
                    p1Mr: p1.master_rating || p1.league_point,
                    p1Score,
                    p2Name: p2.player.fighter_id,
                    p2Id: String(p2.player.short_id),
                    p2Character: p2.playing_character_name,
                    p2Type: formatControlType(p2.battle_input_type_name),
                    p2Mr: p2.master_rating || p2.league_point,
                    p2Score,
                    winner: p1Score > p2Score ? 1 : p1Score < p2Score ? 2 : 0,
                    replayId: match.replay_id || ''
                });
            } catch { }
        });
    } catch { }
    return battles;
}

function parseDetailedStats(playData) {
    const stats = { battle_trends: [], drive_gauge: [], sa_gauge: [] };
    const bs = playData?.battle_stats;
    if (!bs) return stats;

    stats.battle_trends = [
        { label: '投げ回数', value: bs.throw_count },
        { label: '被投げ回数', value: bs.received_throw_count },
        { label: '投げ抜け回数', value: bs.throw_tech },
        { label: 'スタン回数', value: bs.stun },
        { label: '被スタン回数', value: bs.received_stun },
        { label: 'ドライブインパクト', value: bs.drive_impact },
        { label: '被ドライブインパクト', value: bs.received_drive_impact },
        { label: 'パニッシュカウンター', value: bs.punish_counter },
        { label: '被パニッシュカウンター', value: bs.received_punish_counter },
        { label: 'ジャストパリィ', value: bs.just_parry },
        { label: '画面端有利時間', value: bs.corner_time != null ? bs.corner_time + 's' : null },
        { label: '画面端不利時間', value: bs.cornered_time != null ? bs.cornered_time + 's' : null }
    ];

    stats.drive_gauge = [
        { label: 'ドライブパリィ', value: bs.gauge_rate_drive_guard != null ? (bs.gauge_rate_drive_guard * 100).toFixed(1) + '%' : null },
        { label: 'ドライブキャンセル', value: bs.gauge_rate_drive_arts != null ? (bs.gauge_rate_drive_arts * 100).toFixed(1) + '%' : null },
        { label: 'ドライブインパクト', value: bs.gauge_rate_drive_impact != null ? (bs.gauge_rate_drive_impact * 100).toFixed(1) + '%' : null },
        { label: 'ドライブリバーサル', value: bs.gauge_rate_drive_reversal != null ? (bs.gauge_rate_drive_reversal * 100).toFixed(1) + '%' : null },
        { label: 'オーバードライブ', value: bs.gauge_rate_drive_other != null ? (bs.gauge_rate_drive_other * 100).toFixed(1) + '%' : null },
        {
            label: 'ドライブラッシュ', value: (bs.gauge_rate_drive_rush_from_cancel != null || bs.gauge_rate_drive_rush_from_parry != null) ?
                (((bs.gauge_rate_drive_rush_from_cancel || 0) + (bs.gauge_rate_drive_rush_from_parry || 0)) * 100).toFixed(1) + '%' : null
        }
    ];

    stats.sa_gauge = [
        { label: 'SA Lv1', value: bs.gauge_rate_sa_lv1 != null ? (bs.gauge_rate_sa_lv1 * 100).toFixed(1) + '%' : null },
        { label: 'SA Lv2', value: bs.gauge_rate_sa_lv2 != null ? (bs.gauge_rate_sa_lv2 * 100).toFixed(1) + '%' : null },
        { label: 'SA Lv3 / CA', value: ((bs.gauge_rate_sa_lv3 || 0) * 100 + (bs.gauge_rate_ca || 0) * 100).toFixed(1) + '%' }
    ];

    return stats;
}

// ========== Cookie同意バナーの処理 ==========
async function dismissCookieBanner(page) {
    try {
        const allowBtn = await page.$('button:has-text("Allow all cookies"), #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
        if (allowBtn) {
            await allowBtn.click();
            console.log("[INFO] Cookie同意バナーを閉じました。");
            await sleep(1000);
        }
    } catch (e) {
        // バナーがなければ無視
    }
}

// ========== ログイン処理 (Buckler経由のOAuth認証) ==========
async function performLogin(page, context) {
    const capcomId = process.env.CAPCOM_ID;
    const capcomPassword = process.env.CAPCOM_PASSWORD;

    if (!capcomId || !capcomPassword) {
        throw new Error(
            "環境変数 CAPCOM_ID と CAPCOM_PASSWORD を設定してください。\n" +
            "PowerShell: $env:CAPCOM_ID = 'your_id'; $env:CAPCOM_PASSWORD = 'your_pass'"
        );
    }

    // Step 1: Bucklerのトップページにアクセス
    console.log("Step 1: Bucklerトップページにアクセス...");
    await page.goto(`${BUCKLER_BASE}/ja-jp`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await sleep(2000);
    await dismissCookieBanner(page);
    await sleep(1000);

    // Step 2: Bucklerの「ログイン / 新規登録」リンクをクリック
    //   右上のログインボタンを探す
    console.log("Step 2: ログインリンクを探してクリック...");

    // ログインリンクのhrefを取得
    let loginHref = null;
    const loginLinkEl = await page.$('a[href*="auth/loginep"]') || await page.$('a[href*="auth/login"]');
    if (loginLinkEl) {
        loginHref = await loginLinkEl.getAttribute('href');
        console.log(`[DEBUG] ログインリンク発見: ${loginHref}`);
    }

    if (!loginHref) {
        // フォールバック: ページ内のリンクを検索
        loginHref = await page.evaluate(() => {
            const links = document.querySelectorAll('a');
            for (const a of links) {
                if (a.href.includes('auth/login')) return a.href;
            }
            return null;
        });
    }

    if (!loginHref) {
        await page.screenshot({ path: 'debug_no_login_link.png' });
        throw new Error("ログインリンクが見つかりません。debug_no_login_link.pngを確認してください。");
    }

    // ログインリンクのURLに直接遷移（クリックの代わりにpage.gotoを使用）
    const loginUrl = loginHref.startsWith('http') ? loginHref : `https://www.streetfighter.com${loginHref}`;
    console.log(`[DEBUG] ログインURLに遷移: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Step 3: 遷移先を確認
    console.log("Step 3: 遷移先を確認...");
    await sleep(3000);

    let currentUrl = page.url();
    console.log(`[DEBUG] 遷移先URL: ${currentUrl}`);

    // すでにBucklerにリダイレクトされている場合（CIDセッションが有効）
    if (currentUrl.includes('streetfighter.com') && currentUrl.includes('status=login')) {
        console.log("[INFO] CAPCOMセッション有効のため、Bucklerに直接リダイレクトされました。");
    } else if (currentUrl.includes('cid.capcom.com') || currentUrl.includes('auth.')) {
        // CAPCOM IDログインページにいる場合 → フォーム入力
        console.log("Step 4: ログインフォームに入力...");
        await dismissCookieBanner(page);

        // メール/ID入力欄を探す
        const emailSelectors = ['input[name="email"]', 'input[name="loginid"]', 'input[type="email"]', '#email'];
        let emailFilled = false;
        for (const sel of emailSelectors) {
            try {
                const input = await page.$(sel);
                if (input) {
                    await input.fill(capcomId);
                    console.log(`[DEBUG] メール入力完了: ${sel}`);
                    emailFilled = true;
                    break;
                }
            } catch (e) { continue; }
        }

        if (!emailFilled) {
            await page.screenshot({ path: 'error_no_email_field.png' });
            throw new Error("メール入力欄が見つかりません。error_no_email_field.pngを確認してください。");
        }

        // パスワード入力
        const passSelectors = ['input[name="password"]', 'input[type="password"]', '#password'];
        for (const sel of passSelectors) {
            try {
                const input = await page.$(sel);
                if (input) {
                    await input.fill(capcomPassword);
                    break;
                }
            } catch (e) { continue; }
        }

        // 送信
        console.log("Step 5: ログインボタンをクリック...");
        const submitSelectors = ['button[type="submit"]', 'input[type="submit"]'];
        for (const sel of submitSelectors) {
            try {
                const btn = await page.$(sel);
                if (btn) { await btn.click(); break; }
            } catch (e) { continue; }
        }

        // ログイン後の遷移待ち
        console.log("Step 6: ログイン完了待ち...");
        await sleep(5000);
        currentUrl = page.url();
        console.log(`[DEBUG] ログイン後URL: ${currentUrl}`);

        // CIDのマイページに飛んだ場合、Bucklerに移動
        if (currentUrl.includes('cid.capcom.com')) {
            console.log("[INFO] CAPCOM IDマイページからBucklerに移動...");
            await page.goto(`${BUCKLER_BASE}/ja-jp`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await sleep(3000);
            await dismissCookieBanner(page);
        }
    } else {
        console.log(`[WARNING] 不明なリダイレクト先: ${currentUrl}`);
        await page.screenshot({ path: 'debug_unknown_redirect.png' });
    }

    // セッション保存
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log("セッション情報を保存: storageState.json");
}

// ========== ログイン状態チェック ==========
async function isLoggedIn(page) {
    const data = await page.evaluate(() => {
        const script = document.getElementById('__NEXT_DATA__');
        if (!script) return { loggedIn: false, reason: 'no __NEXT_DATA__' };
        const parsed = JSON.parse(script.innerText);
        const pp = parsed.props?.pageProps || {};
        const keys = Object.keys(pp);
        const hasData = !!pp.play || !!pp.fighter_banner_info;
        return { loggedIn: hasData, reason: hasData ? 'has player data' : `pageProps keys: [${keys.join(', ')}]` };
    });
    return data;
}

// ========== メイン処理 ==========
(async () => {
    const browser = await chromium.launch({ headless: true });

    const contextOptions = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (hasStorageState()) {
        console.log("既存のセッション情報を読み込みます...");
        contextOptions.storageState = STORAGE_STATE_PATH;
    }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
        // 0. 対象SID一覧を取得
        const TARGET_SIDS = await getTargetSids();

        // 1. プロフィールページにアクセスしてログイン状態を確認
        console.log("ログイン状態を確認中...");
        await page.goto(`${BUCKLER_BASE}/ja-jp/profile/${TARGET_SIDS[0]}/play`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await sleep(3000);
        await dismissCookieBanner(page);
        await sleep(2000);

        let loginCheck = await isLoggedIn(page);
        console.log(`[DEBUG] ログインチェック: ${JSON.stringify(loginCheck)}`);

        if (!loginCheck.loggedIn) {
            console.log("未ログイン状態です。ログイン処理を開始します...\n");

            // 古いセッション情報を削除
            if (hasStorageState()) {
                fs.unlinkSync(STORAGE_STATE_PATH);
                console.log("[INFO] 古いstorageState.jsonを削除しました。");
            }

            await performLogin(page, context);

            // ログイン後に再度プロフィールページへ
            console.log("\nプロフィールページに再アクセス...");
            await page.goto(`${BUCKLER_BASE}/ja-jp/profile/${TARGET_SIDS[0]}/play`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await sleep(5000);
            await dismissCookieBanner(page);

            loginCheck = await isLoggedIn(page);
            console.log(`[DEBUG] 再チェック: ${JSON.stringify(loginCheck)}`);
            await page.screenshot({ path: 'debug_final_check.png' });

            if (!loginCheck.loggedIn) {
                console.log("[ERROR] ログイン後もデータが取得できません。");
                console.log("[INFO] debug_final_check.pngを確認してください。");
                console.log("[TIP] ブラウザのheadlessをfalseにしてデバッグしてみてください。");
                throw new Error("ログイン後もデータが取得できません。");
            }
        }

        console.log("\nログイン済み！データ取得を開始します。\n");

        // ログインユーザー情報の取得
        const loginUserInfo = await page.evaluate(() => {
            const script = document.getElementById('__NEXT_DATA__');
            if (!script) return null;
            const data = JSON.parse(script.innerText);
            return data.props?.pageProps?.common?.loginUser || null;
        });
        if (loginUserInfo) {
            console.log(`ログインユーザー: ${loginUserInfo.fighterId} (SID: ${loginUserInfo.shortId})`);
        }

        // 2. 各プレイヤーデータの取得
        for (const sid of TARGET_SIDS) {
            console.log(`========== SID: ${sid} ==========`);
            const result = {
                shortId: sid,
                fetchedAt: new Date().toISOString(),
                currentAct: [],
                pastActs: {},
                battleLog: [],
                battleStats: {}
            };

            // 対象プレイヤーのPlayページに遷移
            await page.goto(`${BUCKLER_BASE}/ja-jp/profile/${sid}/play`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await sleep(3000);

            const nextData = await page.evaluate(() => {
                const script = document.getElementById('__NEXT_DATA__');
                return script ? JSON.parse(script.innerText) : null;
            });

            if (!nextData) {
                console.error(`  __NEXT_DATA__ 取得失敗。スキップ。`);
                await page.screenshot({ path: `error_${sid}.png` });
                continue;
            }

            const pProps = nextData.props.pageProps;

            const charInfos = pProps.play?.character_league_infos || [];

            result.fighterName = pProps.fighter_banner_info?.personal_info?.fighter_id || 'Unknown';
            result.favoriteCharacterName = pProps.fighter_banner_info?.favorite_character_name || 'Unknown';
            result.currentAct = charInfos.filter(c => c.is_played).map(c => ({
                characterName: c.character_name,
                lp: c.league_info?.league_point,
                mr: c.league_info?.master_rating,
                mrRanking: c.league_info?.master_rating_ranking || null,
                leagueRank: c.league_info?.league_rank
            }));

            // バトル統計 (battle_stats) の抽出
            result.battleStats = parseDetailedStats(pProps.play);

            console.log(`  Fighter: ${result.fighterName}`);
            console.log(`  Favorite: ${result.favoriteCharacterName}`);
            console.log(`  現Act: ${result.currentAct.length} キャラ`);
            if (result.battleStats.battle_trends.length > 0) {
                console.log(`  バトル統計: ${result.battleStats.battle_trends.length} 項目`);
            }

            // 差分チェック: 既存データの取得
            const existingActIds = await getExistingActIds(sid);
            const existingReplayIds = await getExistingReplayIds(sid);
            if (supabase) {
                console.log(`  [差分] 取得済みAct: ${existingActIds.size}件, 取得済みバトル: ${existingReplayIds.size}件`);
            }

            // 過去Actデータの取得 (新パラメータ形式 leagueinfo API)
            const numericSid = parseInt(sid, 10);
            let actSkipped = 0;
            for (const actId of ACT_RANGE) {
                // 差分チェック: 取得済みActはスキップ
                if (existingActIds.has(actId)) {
                    actSkipped++;
                    console.log(`  Act ${actId}... SKIP (取得済み)`);
                    continue;
                }
                process.stdout.write(`  Act ${actId}...`);
                try {
                    const actData = await page.evaluate(async ({ numSid, actId }) => {
                        const r = await fetch('/6/buckler/api/profile/play/act/leagueinfo', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ targetShortId: numSid, targetSeasonId: actId, targetModeId: 1, lang: 'ja-jp' })
                        });
                        return { status: r.status, body: await r.text() };
                    }, { numSid: numericSid, actId });

                    let parsed;
                    try { parsed = JSON.parse(actData.body); } catch { parsed = null; }

                    if (parsed?.response?.character_league_infos) {
                        const chars = parsed.response.character_league_infos.filter(c => c.is_played).map(c => ({
                            characterName: c.character_name,
                            lp: c.league_info?.league_point,
                            mr: c.league_info?.master_rating,
                            mrRanking: c.league_info?.master_rating_ranking || null,
                            leagueRank: c.league_info?.league_rank
                        }));
                        result.pastActs[actId] = chars;
                        console.log(` OK (${chars.length})`);
                    } else {
                        console.log(` -`);
                    }
                } catch (err) {
                    console.log(` ERR: ${err.message}`);
                }
                await sleep(1500);
            }
            if (actSkipped > 0) {
                console.log(`  → ${actSkipped}件のActをスキップしました`);
            }

            // バトルログの取得 (最大10ページ = 100戦, 差分対応)
            console.log(`\n  バトルログ取得中...`);
            const allBattles = [];
            let reachedKnown = false;
            for (let pg = 1; pg <= 10; pg++) {
                process.stdout.write(`  page ${pg}...`);
                try {
                    await page.goto(`${BUCKLER_BASE}/ja-jp/profile/${sid}/battlelog/rank?page=${pg}`, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });
                    await sleep(2000);

                    const pageData = await page.evaluate(() => {
                        const script = document.getElementById('__NEXT_DATA__');
                        return script ? JSON.parse(script.innerText) : null;
                    });

                    if (!pageData) {
                        console.log(` no data`);
                        break;
                    }

                    const pageBattles = parseBattleLogFromPage(pageData);
                    if (pageBattles.length === 0) {
                        console.log(` empty`);
                        break;
                    }

                    // 差分チェック: 既知のreplay_idに3件連続到達したら打ち切り
                    let consecutiveKnown = 0;
                    let newInPage = 0;
                    for (const b of pageBattles) {
                        if (existingReplayIds.has(b.replayId)) {
                            consecutiveKnown++;
                            if (consecutiveKnown >= 3) {
                                reachedKnown = true;
                                break;
                            }
                        } else {
                            consecutiveKnown = 0;
                            allBattles.push(b);
                            newInPage++;
                        }
                    }

                    if (reachedKnown) {
                        console.log(` ${newInPage}件新規 → 既知データ到達 (計${allBattles.length})`);
                        break;
                    }

                    console.log(` ${newInPage}件新規 (計${allBattles.length})`);

                    if (allBattles.length >= 100) break;
                } catch (err) {
                    console.log(` ERR: ${err.message}`);
                    break;
                }
                await sleep(1500);
            }
            result.battleLog = allBattles;
            console.log(`  バトルログ合計: ${allBattles.length}件${reachedKnown ? ' (差分取得)' : ''}`);

            // JSON保存
            const outputPath = path.join(__dirname, 'data', `${sid}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
            console.log(`\n保存完了: ${outputPath}`);
        }

    } catch (err) {
        console.error("\nエラー:", err.message);
        try { await page.screenshot({ path: 'error_screenshot.png' }); } catch { }
    } finally {
        await browser.close();
        console.log("\n完了。");
    }
})();
