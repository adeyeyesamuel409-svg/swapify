-- Auth migration (off AWS Cognito): store an email+password credential hash on
-- the user so the API can authenticate without Cognito. Nullable because
-- existing accounts (or future social-login accounts) may not use a password.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;