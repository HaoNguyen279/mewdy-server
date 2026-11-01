-- =====================================================================
-- DATING APP - PostgreSQL schema
-- Tables: users, profiles, photos, preferences, swipes, matches,
--         conversations
-- Yêu cầu: PostgreSQL 13+ (gen_random_uuid có sẵn). PG < 13 dùng pgcrypto.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- dự phòng cho PG < 13

-- ---------------------------------------------------------------------
-- 0. ENUM TYPES
-- ---------------------------------------------------------------------
CREATE TYPE user_status     AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE gender_type     AS ENUM ('male', 'female', 'non_binary', 'other');
CREATE TYPE interested_type AS ENUM ('male', 'female', 'everyone');
CREATE TYPE swipe_action    AS ENUM ('like', 'pass', 'super_like');
CREATE TYPE match_status    AS ENUM ('active', 'unmatched');

-- ---------------------------------------------------------------------
-- 0.1 HÀM DÙNG CHUNG: tự cập nhật updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 1. USERS
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    email           varchar(255),
    email_verified   boolean      NOT NULL DEFAULT false,
    google_sub      varchar(255),
    firebase_uid    varchar(255),
    phone           varchar(20),
    password_hash   text,                                  -- NULL nếu đăng nhập bằng OAuth/OTP
    status          user_status  NOT NULL DEFAULT 'active',
    last_active_at  timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),

    -- Phải có ít nhất một cách đăng nhập
    CONSTRAINT users_contact_required
        CHECK (email IS NOT NULL OR phone IS NOT NULL OR google_sub IS NOT NULL OR firebase_uid IS NOT NULL),
    CONSTRAINT users_email_format
        CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT users_phone_format
        CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{8,15}$')
);

CREATE TABLE email_verification_tokens (
    user_id    uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash char(64)    NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_tokens_expiry_idx ON email_verification_tokens (expires_at);

-- Email không phân biệt hoa thường; phone unique (NULL được phép lặp)
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE UNIQUE INDEX users_google_sub_uq ON users (google_sub);
CREATE UNIQUE INDEX users_firebase_uid_uq ON users (firebase_uid);
CREATE UNIQUE INDEX users_phone_uq ON users (phone);
CREATE INDEX users_status_idx      ON users (status);
CREATE INDEX users_last_active_idx ON users (last_active_at DESC);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 2. PROFILES (1 - 1 với users)
-- ---------------------------------------------------------------------
CREATE TABLE profiles (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid          NOT NULL UNIQUE
                                REFERENCES users (id) ON DELETE CASCADE,
    display_name  varchar(50)   NOT NULL,
    birth_date    date          NOT NULL,
    gender        gender_type   NOT NULL,
    bio           text,
    job_title     varchar(100),
    pet           varchar(50),
    height_cm     smallint,
    city          varchar(100),
    ward          varchar(100),
    hobbies       jsonb         NOT NULL DEFAULT '[]'::jsonb,
    latitude      numeric(9,6),
    longitude     numeric(9,6),
    is_verified   boolean       NOT NULL DEFAULT false,

    CONSTRAINT profiles_display_name_not_blank CHECK (length(btrim(display_name)) > 0),
    CONSTRAINT profiles_bio_len    CHECK (bio IS NULL OR length(bio) <= 500),
    CONSTRAINT profiles_height     CHECK (height_cm IS NULL OR height_cm BETWEEN 100 AND 250),
    CONSTRAINT profiles_lat_range  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    CONSTRAINT profiles_lng_range  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    -- Có toạ độ thì phải có đủ cả hai
    CONSTRAINT profiles_geo_pair   CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX profiles_gender_idx ON profiles (gender);
CREATE INDEX profiles_birth_idx  ON profiles (birth_date);
CREATE INDEX profiles_geo_idx    ON profiles (latitude, longitude);
-- Gợi ý: dữ liệu lớn nên dùng PostGIS (geography + GiST index) thay cho 2 cột này.

-- Chỉ cho phép người từ 18 tuổi trở lên
-- (dùng trigger vì CHECK không nên phụ thuộc vào ngày hiện tại)
CREATE OR REPLACE FUNCTION enforce_min_age()
RETURNS trigger AS $$
BEGIN
    IF NEW.birth_date > (current_date - INTERVAL '18 years') THEN
        RAISE EXCEPTION 'User must be at least 18 years old (birth_date = %)', NEW.birth_date
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_min_age
    BEFORE INSERT OR UPDATE OF birth_date ON profiles
    FOR EACH ROW EXECUTE FUNCTION enforce_min_age();

-- ---------------------------------------------------------------------
-- 3. PHOTOS (1 - N với users)
-- ---------------------------------------------------------------------
CREATE TABLE photos (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL
                             REFERENCES users (id) ON DELETE CASCADE,
    url         text         NOT NULL,
    position    smallint     NOT NULL DEFAULT 0,
    is_primary  boolean      NOT NULL DEFAULT false,
    created_at  timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT photos_url_not_blank CHECK (length(btrim(url)) > 0),
    CONSTRAINT photos_position_range CHECK (position BETWEEN 0 AND 8),   -- tối đa 9 ảnh
    CONSTRAINT photos_user_position_uq UNIQUE (user_id, position)
        DEFERRABLE INITIALLY IMMEDIATE                                   -- cho phép hoán đổi thứ tự trong 1 transaction
);

-- Mỗi user chỉ có tối đa 1 ảnh đại diện
CREATE UNIQUE INDEX photos_one_primary_per_user
    ON photos (user_id) WHERE is_primary;

-- ---------------------------------------------------------------------
-- 4. PREFERENCES (1 - 1 với users)
-- ---------------------------------------------------------------------
CREATE TABLE preferences (
    id               uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid             NOT NULL UNIQUE
                                      REFERENCES users (id) ON DELETE CASCADE,
    interested_in    interested_type  NOT NULL DEFAULT 'everyone',
    age_min          smallint         NOT NULL DEFAULT 18,
    age_max          smallint         NOT NULL DEFAULT 99,
    max_distance_km  integer          NOT NULL DEFAULT 50,
    show_me          boolean          NOT NULL DEFAULT true,
    updated_at       timestamptz      NOT NULL DEFAULT now(),

    CONSTRAINT preferences_age_min   CHECK (age_min >= 18),
    CONSTRAINT preferences_age_range CHECK (age_max >= age_min AND age_max <= 120),
    CONSTRAINT preferences_distance  CHECK (max_distance_km BETWEEN 1 AND 20000)
);

CREATE TRIGGER trg_preferences_updated_at
    BEFORE UPDATE ON preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 5. SWIPES
-- ---------------------------------------------------------------------
CREATE TABLE swipes (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    swiper_id   uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    swiped_id   uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    action      swipe_action  NOT NULL,
    created_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT swipes_no_self_swipe CHECK (swiper_id <> swiped_id),
    -- Một người chỉ vuốt một người khác đúng 1 lần
    CONSTRAINT swipes_pair_uq UNIQUE (swiper_id, swiped_id)
);

-- Tìm "ai đã like tôi" và kiểm tra like ngược để tạo match
CREATE INDEX swipes_swiped_action_idx ON swipes (swiped_id, action);

-- ---------------------------------------------------------------------
-- 6. MATCHES
-- ---------------------------------------------------------------------
CREATE TABLE matches (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id      uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user2_id      uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status        match_status  NOT NULL DEFAULT 'active',
    matched_at    timestamptz   NOT NULL DEFAULT now(),
    unmatched_at  timestamptz,

    -- Quy ước user1_id < user2_id để cặp (A,B) và (B,A) không bị trùng
    CONSTRAINT matches_order_check CHECK (user1_id < user2_id),
    CONSTRAINT matches_pair_uq UNIQUE (user1_id, user2_id),
    -- unmatched_at chỉ có giá trị khi status = 'unmatched'
    CONSTRAINT matches_unmatched_consistent
        CHECK ((status = 'unmatched') = (unmatched_at IS NOT NULL))
);

CREATE INDEX matches_user2_idx ON matches (user2_id);   -- user1_id đã được phủ bởi unique index
CREATE INDEX matches_status_idx ON matches (status);

-- ---------------------------------------------------------------------
-- 7. CONVERSATIONS (1 - 1 với matches)
-- ---------------------------------------------------------------------
CREATE TABLE conversations (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id         uuid         NOT NULL UNIQUE
                                  REFERENCES matches (id) ON DELETE CASCADE,
    last_message_at  timestamptz,
    created_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX conversations_last_message_idx ON conversations (last_message_at DESC NULLS LAST);

-- ---------------------------------------------------------------------
-- 9. TRIGGERS NGHIỆP VỤ
-- ---------------------------------------------------------------------

-- Tự động tạo match + conversation khi hai người like nhau
CREATE OR REPLACE FUNCTION create_match_on_mutual_like()
RETURNS trigger AS $$
DECLARE
    v_match_id uuid;
BEGIN
    IF NEW.action IN ('like', 'super_like')
       AND EXISTS (
            SELECT 1 FROM swipes s
            WHERE s.swiper_id = NEW.swiped_id
              AND s.swiped_id = NEW.swiper_id
              AND s.action IN ('like', 'super_like')
       )
    THEN
        INSERT INTO matches (user1_id, user2_id)
        VALUES (LEAST(NEW.swiper_id, NEW.swiped_id),
                GREATEST(NEW.swiper_id, NEW.swiped_id))
        ON CONFLICT (user1_id, user2_id) DO NOTHING
        RETURNING id INTO v_match_id;

        IF v_match_id IS NOT NULL THEN
            INSERT INTO conversations (match_id) VALUES (v_match_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_swipes_create_match
    AFTER INSERT ON swipes
    FOR EACH ROW EXECUTE FUNCTION create_match_on_mutual_like();

-- =====================================================================
-- (Tuỳ chọn) Xoá toàn bộ để tạo lại
-- DROP TABLE IF EXISTS conversations, matches, swipes,
--                      preferences, photos, profiles, users CASCADE;
-- DROP TYPE IF EXISTS match_status, swipe_action,
--                     interested_type, gender_type, user_status;
-- DROP FUNCTION IF EXISTS set_updated_at, enforce_min_age,
--      create_match_on_mutual_like;
-- =====================================================================
