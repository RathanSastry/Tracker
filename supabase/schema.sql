-- ════════════════════════════════════════
-- DRS Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════

-- PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT,
  avatar TEXT DEFAULT '🏃',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read_all"   ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_own_write"  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_own_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- SETTINGS
CREATE TABLE IF NOT EXISTS settings (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  weight_kg NUMERIC DEFAULT 70,
  age INTEGER DEFAULT 25,
  gender TEXT DEFAULT 'male',
  resting_hr INTEGER DEFAULT 60,
  audio_on BOOLEAN DEFAULT TRUE,
  hydration_reminders BOOLEAN DEFAULT TRUE,
  safety_alerts BOOLEAN DEFAULT TRUE
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_own" ON settings FOR ALL USING (auth.uid() = user_id);

-- WORKOUTS
CREATE TABLE IF NOT EXISTS workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ DEFAULT NOW(),
  mode TEXT,
  distance_km NUMERIC DEFAULT 0,
  duration_ms BIGINT DEFAULT 0,
  avg_pace_sec_per_km NUMERIC DEFAULT 0,
  calories INTEGER DEFAULT 0,
  steps INTEGER DEFAULT 0,
  avg_hr INTEGER DEFAULT 0,
  max_speed_kmh NUMERIC DEFAULT 0,
  avg_speed_kmh NUMERIC DEFAULT 0,
  zone_seconds JSONB DEFAULT '{}',
  coords JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workouts_read_all"   ON workouts FOR SELECT USING (true);
CREATE POLICY "workouts_own_insert" ON workouts FOR INSERT WITH CHECK (auth.uid() = user_id);

-- BADGES
CREATE TABLE IF NOT EXISTS badges (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id TEXT,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_id)
);
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "badges_read_all"  ON badges FOR SELECT USING (true);
CREATE POLICY "badges_own_write" ON badges FOR ALL USING (auth.uid() = user_id);

-- SUBSCRIPTIONS (Pro status — only written by Edge Function)
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'inactive',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_own_read" ON subscriptions FOR SELECT USING (auth.uid() = user_id);

-- FEED POSTS
CREATE TABLE IF NOT EXISTS feed_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id UUID REFERENCES workouts(id) ON DELETE SET NULL,
  text TEXT,
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feed_read_all"    ON feed_posts FOR SELECT USING (true);
CREATE POLICY "feed_own_insert"  ON feed_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "feed_own_update"  ON feed_posts FOR UPDATE USING (auth.uid() = user_id);

-- POST LIKES
CREATE TABLE IF NOT EXISTS post_likes (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES feed_posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "likes_read_all" ON post_likes FOR SELECT USING (true);
CREATE POLICY "likes_own"      ON post_likes FOR ALL USING (auth.uid() = user_id);

-- FRIENDS
CREATE TABLE IF NOT EXISTS friends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (requester_id, addressee_id)
);
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "friends_own" ON friends FOR ALL
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- CHALLENGES
CREATE TABLE IF NOT EXISTS challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  type TEXT,
  target NUMERIC,
  duration_days INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "challenges_read_all"   ON challenges FOR SELECT USING (true);
CREATE POLICY "challenges_own_insert" ON challenges FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- CHALLENGE PARTICIPANTS
CREATE TABLE IF NOT EXISTS challenge_participants (
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  progress NUMERIC DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (challenge_id, user_id)
);
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants_read_all"  ON challenge_participants FOR SELECT USING (true);
CREATE POLICY "participants_own_write" ON challenge_participants FOR ALL USING (auth.uid() = user_id);
