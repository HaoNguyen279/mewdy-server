-- Existing accounts with an email are grandfathered to preserve current access.
-- New users and legacy accounts without an email remain unverified.
ALTER TABLE "users"
ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "users"
SET "email_verified" = TRUE
WHERE "email" IS NOT NULL;

CREATE TABLE "email_verification_tokens" (
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "email_verification_tokens_hash_uq" UNIQUE ("token_hash"),
    CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id")
      REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "email_verification_tokens_expiry_idx"
ON "email_verification_tokens"("expires_at");
