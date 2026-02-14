-- =============================================================
-- SF6 Buckler Scraper — Supabase テーブル定義
-- =============================================================

-- 1. プレイヤーマスタ
CREATE TABLE IF NOT EXISTS players (
  short_id    TEXT PRIMARY KEY,
  fighter_name TEXT NOT NULL DEFAULT 'Unknown',
  favorite_character TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Act 履歴 (現在Act + 過去Act)
CREATE TABLE IF NOT EXISTS act_history (
  id              BIGSERIAL PRIMARY KEY,
  short_id        TEXT NOT NULL REFERENCES players(short_id) ON DELETE CASCADE,
  act_id          INTEGER NOT NULL,          -- 0~11, -1 = current
  is_current      BOOLEAN NOT NULL DEFAULT false,
  character_name  TEXT NOT NULL,
  lp              INTEGER DEFAULT -1,
  mr              INTEGER DEFAULT 0,
  mr_ranking      INTEGER DEFAULT NULL,      -- 世界ランキング (master_rating_ranking)
  league_rank     INTEGER DEFAULT 39,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (short_id, act_id, character_name)
);

CREATE INDEX IF NOT EXISTS idx_act_history_sid ON act_history(short_id);
CREATE INDEX IF NOT EXISTS idx_act_history_act ON act_history(short_id, act_id);

-- 3. バトルログ
CREATE TABLE IF NOT EXISTS battle_log (
  id            BIGSERIAL PRIMARY KEY,
  short_id      TEXT NOT NULL REFERENCES players(short_id) ON DELETE CASCADE,
  replay_id     TEXT NOT NULL UNIQUE,
  match_type    TEXT DEFAULT 'rank',       -- 'rank' / 'casual' / 'custom' / 'hub'
  battle_date   TIMESTAMPTZ NOT NULL,
  p1_name       TEXT,
  p1_id         TEXT,
  p1_character  TEXT,
  p1_type       TEXT,
  p1_mr         INTEGER DEFAULT 0,
  p1_score      INTEGER DEFAULT 0,
  p2_name       TEXT,
  p2_id         TEXT,
  p2_character  TEXT,
  p2_type       TEXT,
  p2_mr         INTEGER DEFAULT 0,
  p2_score      INTEGER DEFAULT 0,
  winner        INTEGER DEFAULT 0,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_battle_log_sid ON battle_log(short_id);
CREATE INDEX IF NOT EXISTS idx_battle_log_date ON battle_log(battle_date DESC);

-- 4. バトル統計 (日次スナップショット)
CREATE TABLE IF NOT EXISTS battle_stats (
  id          BIGSERIAL PRIMARY KEY,
  short_id    TEXT NOT NULL REFERENCES players(short_id) ON DELETE CASCADE,
  category    TEXT NOT NULL,   -- 'battle_trends', 'drive_gauge', 'sa_gauge'
  label       TEXT NOT NULL,
  value       TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (short_id, category, label, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_battle_stats_sid ON battle_stats(short_id);

-- 5. サブスクリプション (フロントエンドからの登録)
CREATE TABLE IF NOT EXISTS subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  device_id   TEXT UNIQUE NOT NULL,       -- デバイス固有ID (拡張ID / アプリID)
  short_id    TEXT NOT NULL,              -- 追跡対象の Short ID
  device_type TEXT DEFAULT 'unknown',     -- 'chrome' / 'web' / 'mobile'
  is_active   BOOLEAN DEFAULT true,
  last_seen   TIMESTAMPTZ DEFAULT now(),  -- アプリ最終アクセス日時
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_subscriptions_sid ON subscriptions(short_id);

-- テスト用初期データ
INSERT INTO subscriptions (device_id, short_id, device_type) VALUES
  ('test-device-001', '2310599217', 'manual'),
  ('test-device-002', '4196667808', 'manual')
ON CONFLICT (device_id) DO NOTHING;

-- RLS (Row Level Security) はデフォルトOFFのまま
-- SERVICE_ROLE_KEY を使用するため、RLSは不要
-- フロントエンド用の anon key アクセスには RLS ポリシーを後で追加

-- 6. 対戦相手マスタ (Subscribed ユーザーとは区別)
CREATE TABLE IF NOT EXISTS enemy_players (
  short_id    TEXT PRIMARY KEY,
  fighter_name TEXT NOT NULL DEFAULT 'Unknown',
  favorite_character TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. 対戦相手 Act 履歴
CREATE TABLE IF NOT EXISTS enemy_act_history (
  id              BIGSERIAL PRIMARY KEY,
  short_id        TEXT NOT NULL REFERENCES enemy_players(short_id) ON DELETE CASCADE,
  act_id          INTEGER NOT NULL,          -- 0~11
  is_current      BOOLEAN NOT NULL DEFAULT false, -- 基本的に false (過去ログ取得が主目的だが、構造は合わせる)
  character_name  TEXT NOT NULL,
  lp              INTEGER DEFAULT -1,
  mr              INTEGER DEFAULT 0,
  mr_ranking      INTEGER DEFAULT NULL,
  league_rank     INTEGER DEFAULT 39,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (short_id, act_id, character_name)
);

CREATE INDEX IF NOT EXISTS idx_enemy_act_history_sid ON enemy_act_history(short_id);
CREATE INDEX IF NOT EXISTS idx_enemy_act_history_act ON enemy_act_history(short_id, act_id);

