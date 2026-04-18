-- CreateTable
CREATE TABLE "ReviewCommentCandidate" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "findingId" TEXT,
    "path" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isPublishable" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCommentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewCommentCandidate_reviewRunId_idx" ON "ReviewCommentCandidate"("reviewRunId");

-- CreateIndex
CREATE INDEX "ReviewCommentCandidate_path_idx" ON "ReviewCommentCandidate"("path");

-- AddForeignKey
ALTER TABLE "ReviewCommentCandidate" ADD CONSTRAINT "ReviewCommentCandidate_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
