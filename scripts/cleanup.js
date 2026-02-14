const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function main() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Error: SUPABASE_URL and SUPABASE_KEY are required.');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // SQLファイルのパス
    const sqlPath = path.join(__dirname, '../migrations/cleanup_query.sql');
    if (!fs.existsSync(sqlPath)) {
        console.error(`Error: SQL file not found at ${sqlPath}`);
        process.exit(1);
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Running cleanup query...');

    // Supabase RPC (Remote Procedure Call) 経由でSQLを実行する
    // プロジェクト設定で "postgres_modules" などを有効にしていないと直接SQL実行APIはないため、
    // 本来はpostgres.jsなどで直接DB接続するか、RPC関数を作る必要がある。

    // しかし、Supabase JS Client自体には生SQLを実行するメソッドは提供されていない。
    // そのため、ここでは「RPC（ストアドプロシージャ）」として登録した関数を呼ぶか、
    // あるいは postgres ライブラリを使って直接接続する必要がある。

    // 今回は、最も確実な「postgres ライブラリ」を使って直接DB接続する方法を採用します。
    // なので、このスクリプトは `pg` モジュールを必要とします。

    // ...と思ったが、GitHub Actions環境に pg を追加インストールするのは手間。
    // 「supabase-js」だけでは生クエリ実行ができない。

    // 代替案: 
    // 単純に、RPCを作成してそれを呼ぶのが一番簡単。
    // 前回ユーザーがSQL Editorで実行したあのクエリを、
    // 「関数」として定義してしまえば、JSから `supabase.rpc('関数名')` で呼べる。

    console.log('Please execute the following SQL in Supabase SQL Editor to create the RPC function first:');
    console.log(`
CREATE OR REPLACE FUNCTION cleanup_old_enemy_histories_rpc()
RETURNS void AS $$
BEGIN
    DELETE FROM enemy_act_history
    WHERE short_id NOT IN (
        SELECT DISTINCT player_id
        FROM (
            SELECT p1_id AS player_id FROM (
                SELECT p1_id, ROW_NUMBER() OVER (PARTITION BY short_id, match_type ORDER BY battle_date DESC) as rn
                FROM battle_log
            ) t1 WHERE rn <= 100
            UNION
            SELECT p2_id AS player_id FROM (
                SELECT p2_id, ROW_NUMBER() OVER (PARTITION BY short_id, match_type ORDER BY battle_date DESC) as rn
                FROM battle_log
            ) t2 WHERE rn <= 100
        ) active_players
    );
END;
$$ LANGUAGE plpgsql;
    `);

    // RPC呼び出し
    const { error } = await supabase.rpc('cleanup_old_enemy_histories_rpc');

    if (error) {
        console.error('Error executing cleanup RPC:', error.message);
        // 関数が見つからない場合のエラーハンドリング
        if (error.message.includes('function') && error.message.includes('does not exist')) {
            console.error('Did you create the RPC function in Supabase?');
        }
        process.exit(1);
    }

    console.log('Cleanup completed successfully.');
}

main();
