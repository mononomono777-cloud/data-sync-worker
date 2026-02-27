/**
 * cleanup.js — 定期データクリーンアップ
 *
 * 保持ポリシー: 直近プレイ3日分 OR 直近100戦
 * Supabase RPC 関数 `cleanup_expired_data()` を呼び出す。
 *
 * 前提: Supabase SQL Editor で migrations/cleanup_query.sql を実行し、
 *       RPC 関数が登録済みであること。
 *
 * 実行方法:
 *   SUPABASE_URL=... SUPABASE_KEY=... node scripts/cleanup.js
 */

const { createClient } = require('@supabase/supabase-js');

async function main() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Error: SUPABASE_URL と SUPABASE_KEY を設定してください。');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('=== Cleanup Start ===');
    console.log(`実行時刻: ${new Date().toISOString()}`);

    const { data, error } = await supabase.rpc('cleanup_expired_data');

    if (error) {
        if (error.message?.includes('does not exist')) {
            console.error('');
            console.error('ERROR: RPC 関数 cleanup_expired_data() が見つかりません。');
            console.error('→ Supabase SQL Editor で migrations/cleanup_query.sql を実行してください。');
        } else {
            console.error('Error executing cleanup RPC:', error.message);
        }
        process.exit(1);
    }

    // RPC は RETURNS TABLE なので data は配列 (1行)
    const result = Array.isArray(data) ? data[0] : data;

    console.log('');
    console.log('=== 削除件数 ===');
    console.log(`  battle_log        : ${result.deleted_battle_log} 件`);
    console.log(`  battle_stats      : ${result.deleted_battle_stats} 件`);
    console.log(`  enemy_act_history : ${result.deleted_enemy_act_history} 件`);
    console.log(`  enemy_players     : ${result.deleted_enemy_players} 件`);
    console.log('');
    console.log('=== Cleanup Complete ===');
}

main();
