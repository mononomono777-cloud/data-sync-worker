/*
  【データ削減クエリ】
  battle_log に基づき、直近100戦（battle_date順）に含まれない対戦相手の enemy_act_history を削除します。
  
  実行頻度: 1日1回〜週1回程度（Supabase SQL Editor または pg_cron で実行）
*/

DELETE FROM enemy_act_history
WHERE short_id NOT IN (
    -- 全ユーザー・全モードの「最新100件（対戦日時順）」に登場するプレイヤーIDリスト
    SELECT DISTINCT player_id
    FROM (
        SELECT p1_id AS player_id FROM (
            -- battle_date (対戦日時) の降順でソートして最新100件を特定
            SELECT p1_id, ROW_NUMBER() OVER (PARTITION BY short_id, match_type ORDER BY battle_date DESC) as rn
            FROM battle_log
        ) t1 WHERE rn <= 100
        UNION
        SELECT p2_id AS player_id FROM (
            -- battle_date (対戦日時) の降順でソートして最新100件を特定
            SELECT p2_id, ROW_NUMBER() OVER (PARTITION BY short_id, match_type ORDER BY battle_date DESC) as rn
            FROM battle_log
        ) t2 WHERE rn <= 100
    ) active_players
);
