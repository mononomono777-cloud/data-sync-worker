/*
  ================================================================
  cleanup_expired_data() — データ保持ポリシー実行 RPC 関数
  ================================================================

  保持ルール:
    battle_log  : 直近プレイ3日分（AM9:00基準の論理日）
    battle_stats: battle_log に残っている論理日のみ保持
    enemy_*     : battle_log に登場する対戦相手のみ保持

  Supabase SQL Editor で以下を実行して登録する。
  ================================================================
*/

CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS TABLE(
  deleted_battle_log        INT,
  deleted_battle_stats      INT,
  deleted_enemy_act_history INT,
  deleted_enemy_players     INT
) AS $$
DECLARE
  v_bl  INT := 0;
  v_bs  INT := 0;
  v_eah INT := 0;
  v_ep  INT := 0;
BEGIN

  -- ------------------------------------------------------------------
  -- 1. battle_log
  --    保持条件: 直近プレイ3日分（AM9:00基準の論理日）
  -- ------------------------------------------------------------------
  WITH to_keep AS (
    SELECT bl.id
    FROM battle_log bl
    INNER JOIN (
      SELECT DISTINCT short_id, play_date
      FROM (
        SELECT short_id,
               (battle_date - INTERVAL '9 hours')::date                       AS play_date,
               DENSE_RANK() OVER (
                 PARTITION BY short_id
                 ORDER BY (battle_date - INTERVAL '9 hours')::date DESC
               )                                                               AS day_rank
        FROM battle_log
      ) ranked_days
      WHERE day_rank <= 3
    ) recent_days
      ON  bl.short_id = recent_days.short_id
      AND (bl.battle_date - INTERVAL '9 hours')::date = recent_days.play_date
  )
  DELETE FROM battle_log
  WHERE id NOT IN (SELECT id FROM to_keep);
  GET DIAGNOSTICS v_bl = ROW_COUNT;

  -- ------------------------------------------------------------------
  -- 2. battle_stats
  --    残存 battle_log の論理日（AM9:00基準）に存在しない行を削除
  -- ------------------------------------------------------------------
  DELETE FROM battle_stats bs
  WHERE NOT EXISTS (
    SELECT 1
    FROM battle_log bl
    WHERE bl.short_id = bs.short_id
      AND (bl.battle_date - INTERVAL '9 hours')::date
        = (bs.fetched_at  - INTERVAL '9 hours')::date
  );
  GET DIAGNOSTICS v_bs = ROW_COUNT;

  -- ------------------------------------------------------------------
  -- 3. enemy_act_history
  --    残存 battle_log に p1_id / p2_id として登場しない相手を削除
  -- ------------------------------------------------------------------
  DELETE FROM enemy_act_history
  WHERE short_id NOT IN (
    SELECT DISTINCT p1_id FROM battle_log WHERE p1_id IS NOT NULL
    UNION
    SELECT DISTINCT p2_id FROM battle_log WHERE p2_id IS NOT NULL
  );
  GET DIAGNOSTICS v_eah = ROW_COUNT;

  -- ------------------------------------------------------------------
  -- 4. enemy_players
  --    enemy_act_history に残っていない相手を削除
  -- ------------------------------------------------------------------
  DELETE FROM enemy_players
  WHERE short_id NOT IN (
    SELECT DISTINCT short_id FROM enemy_act_history
  );
  GET DIAGNOSTICS v_ep = ROW_COUNT;

  RETURN QUERY SELECT v_bl, v_bs, v_eah, v_ep;
END;
$$ LANGUAGE plpgsql;
