ALTER TABLE "ReviewRun"
ADD COLUMN "llmStatus" TEXT NOT NULL DEFAULT 'disabled',
ADD COLUMN "publishState" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN "llmError" TEXT,
ADD COLUMN "llmSummary" TEXT,
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "ReviewFinding"
ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'deterministic',
ADD COLUMN "fingerprint" TEXT,
ADD COLUMN "publishReason" TEXT,
ADD COLUMN "suppressionReason" TEXT,
ADD COLUMN "metadata" JSONB;

ALTER TABLE "ReviewCommentCandidate"
ADD COLUMN "findingFingerprint" TEXT,
ADD COLUMN "metadata" JSONB;

ALTER TABLE "ReviewCommentPreview"
ADD COLUMN "metadata" JSONB;

ALTER TABLE "ReviewPublication"
ADD COLUMN "requestKey" TEXT;

CREATE UNIQUE INDEX "ReviewPublication_reviewRunId_requestKey_key"
ON "ReviewPublication"("reviewRunId", "requestKey");
