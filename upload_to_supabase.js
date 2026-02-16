const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ========== 設定 ==========
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('環境変数 SUPABASE_URL と SUPABASE_KEY を設定してください。');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ========== ユーティリティ ==========

/**
 * data/ ディレクトリ内の全JSONファイルパスを取得
 * 引数でファイルパスを指定した場合はそれを使用
 */
function getDataFiles() {
    const args = process.argv.slice(2);
    if (args.length > 0) {
        // 引数で指定されたファイル
        return args.map(f => path.resolve(f));
    }
    // デフォルト: data/ 配下の全 .json
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        console.error('data/ ディレクトリが見つかりません。');
        process.exit(1);
    }
    return fs.readdirSync(dataDir)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(dataDir, f));
}

// ========== アップロード関数 ==========

async function upsertPlayer(data) {
    const { error } = await supabase
        .from('players')
        .upsert({
            short_id: data.shortId,
            fighter_name: data.fighterName || 'Unknown',
            favorite_character: data.favoriteCharacterName || null,
            updated_at: data.fetchedAt
        }, { onConflict: 'short_id' });

    if (error) throw new Error(`players upsert failed: ${error.message}`);
    console.log(`  ✓ players: ${data.fighterName} (${data.shortId})`);
}

async function upsertActHistory(data) {
    const rows = [];
    const fetchedAt = data.fetchedAt;

    // 現在Act
    if (data.currentAct && data.currentAct.length > 0) {
        for (const char of data.currentAct) {
            rows.push({
                short_id: data.shortId,
                act_id: -1,  // current
                is_current: true,
                character_name: char.characterName,
                lp: char.lp ?? -1,
                mr: char.mr ?? 0,
                mr_ranking: char.mrRanking ?? null,
                league_rank: char.leagueRank ?? 39,
                fetched_at: fetchedAt
            });
        }
    }

    // 過去Act
    if (data.pastActs) {
        for (const [actId, chars] of Object.entries(data.pastActs)) {
            for (const char of chars) {
                rows.push({
                    short_id: data.shortId,
                    act_id: parseInt(actId, 10),
                    is_current: false,
                    character_name: char.characterName,
                    lp: char.lp ?? -1,
                    mr: char.mr ?? 0,
                    mr_ranking: char.mrRanking ?? null,
                    league_rank: char.leagueRank ?? 39,
                    fetched_at: fetchedAt
                });
            }
        }
    }

    if (rows.length === 0) {
        console.log('  - act_history: データなし');
        return;
    }

    // バッチ upsert (50件ずつ)
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await supabase
            .from('act_history')
            .upsert(batch, { onConflict: 'short_id,act_id,character_name' });

        if (error) throw new Error(`act_history upsert failed: ${error.message}`);
    }
    console.log(`  ✓ act_history: ${rows.length} 件`);
}

async function upsertEnemyPlayer(data) {
    const { error } = await supabase
        .from('enemy_players')
        .upsert({
            short_id: data.shortId,
            fighter_name: data.fighterName || 'Unknown',
            favorite_character: data.favoriteCharacterName || null,
            updated_at: data.fetchedAt
        }, { onConflict: 'short_id' });

    if (error) throw new Error(`enemy_players upsert failed: ${error.message}`);
    // console.log(`  ✓ enemy_players: ${data.fighterName} (${data.shortId})`);
}

async function upsertEnemyActHistory(data) {
    const rows = [];
    const fetchedAt = data.fetchedAt;

    // 過去Actのみ (構造はact_historyと同じ)
    if (data.pastActs) {
        for (const [actId, chars] of Object.entries(data.pastActs)) {
            for (const char of chars) {
                rows.push({
                    short_id: data.shortId,
                    act_id: parseInt(actId, 10),
                    is_current: false,
                    character_name: char.characterName,
                    lp: char.lp ?? -1,
                    mr: char.mr ?? 0,
                    mr_ranking: char.mrRanking ?? null,
                    league_rank: char.leagueRank ?? 39,
                    fetched_at: fetchedAt
                });
            }
        }
    }

    if (rows.length === 0) return;

    // バッチ upsert (50件ずつ)
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await supabase
            .from('enemy_act_history')
            .upsert(batch, { onConflict: 'short_id,act_id,character_name' });

        if (error) throw new Error(`enemy_act_history upsert failed: ${error.message}`);
    }
    console.log(`  ✓ enemy_act_history: ${rows.length} 件 (SID: ${data.shortId})`);
}

async function upsertBattleLog(data) {
    if (!data.battleLog || data.battleLog.length === 0) {
        console.log('  - battle_log: データなし');
        return;
    }

    const rows = data.battleLog.map(b => ({
        short_id: data.shortId,
        replay_id: b.replayId,
        match_type: b.matchType || 'rank',
        battle_date: b.date,
        p1_name: b.p1Name,
        p1_id: b.p1Id,
        p1_character: b.p1Character,
        p1_type: b.p1Type,
        p1_mr: b.p1Mr ?? 0,
        p1_score: b.p1Score ?? 0,
        p2_name: b.p2Name,
        p2_id: b.p2Id,
        p2_character: b.p2Character,
        p2_type: b.p2Type,
        p2_mr: b.p2Mr ?? 0,
        p2_score: b.p2Score ?? 0,
        winner: b.winner ?? 0,
        fetched_at: data.fetchedAt
    }));

    // バッチ upsert (50件ずつ)
    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await supabase
            .from('battle_log')
            .upsert(batch, { onConflict: 'replay_id', ignoreDuplicates: true });

        if (error) {
            console.warn(`  ⚠ battle_log batch ${i}: ${error.message}`);
            skipped += batch.length;
        } else {
            inserted += batch.length;
        }
    }
    console.log(`  ✓ battle_log: ${inserted} 件 (${skipped > 0 ? `${skipped} 件スキップ` : '重複なし'})`);
}

async function upsertBattleStats(data) {
    if (!data.battleStats) {
        console.log('  - battle_stats: データなし');
        return;
    }

    // 今日のデータが既にあればスキップ（1日1回制限）
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const { data: existing } = await supabase
        .from('battle_stats')
        .select('id')
        .eq('short_id', data.shortId)
        .gte('fetched_at', today + 'T00:00:00Z')
        .limit(1);
    if (existing && existing.length > 0) {
        console.log('  - battle_stats: 本日分は取得済み。スキップ。');
        return;
    }

    const rows = [];
    const fetchedAt = data.fetchedAt;

    for (const category of ['battle_trends', 'drive_gauge', 'sa_gauge']) {
        const items = data.battleStats[category];
        if (!items || !Array.isArray(items)) continue;

        for (const item of items) {
            rows.push({
                short_id: data.shortId,
                category,
                label: item.label,
                value: item.value != null ? String(item.value) : null,
                fetched_at: fetchedAt
            });
        }
    }

    if (rows.length === 0) {
        console.log('  - battle_stats: データなし');
        return;
    }

    const { error } = await supabase
        .from('battle_stats')
        .upsert(rows, { onConflict: 'short_id,category,label,fetched_at' });

    if (error) throw new Error(`battle_stats upsert failed: ${error.message}`);
    console.log(`  ✓ battle_stats: ${rows.length} 件`);
}

// ========== メイン処理 ==========

(async () => {
    const files = getDataFiles();

    if (files.length === 0) {
        console.log('アップロード対象のJSONファイルがありません。');
        process.exit(0);
    }

    console.log(`\n=== Supabase Upload ===`);
    console.log(`対象ファイル: ${files.length} 件\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const filePath of files) {
        const fileName = path.basename(filePath);
        console.log(`--- ${fileName} ---`);

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(raw);

            if (!data.shortId) {
                console.log('  ⚠ shortId が見つかりません。スキップ。');
                errorCount++;
                continue;
            }

            await upsertPlayer(data);
            await upsertActHistory(data);

            if (data.opponents) {
                const oppIds = Object.keys(data.opponents);
                for (const oppId of oppIds) {
                    const oppData = data.opponents[oppId];
                    await upsertEnemyPlayer(oppData);
                    await upsertEnemyActHistory(oppData);
                }
            }
            await upsertBattleLog(data);
            await upsertBattleStats(data);

            successCount++;
            console.log(`  → 完了\n`);
        } catch (err) {
            console.error(`  ✗ エラー: ${err.message}\n`);
            errorCount++;
        }
    }

    console.log(`=== 結果: ${successCount} 成功 / ${errorCount} エラー ===\n`);
    process.exit(errorCount > 0 ? 1 : 0);
})();
