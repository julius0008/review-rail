-- CreateTable
CREATE TABLE "ReviewCommentPreview" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "candidateId" TEXT,
    "path" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "line" INTEGER,
    "side" TEXT,
    "startLine" INTEGER,
    "startSide" TEXT,
    "commitId" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCommentPreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewCommentPreview_reviewRunId_idx" ON "ReviewCommentPreview"("reviewRunId");

-- AddForeignKey
ALTER TABLE "ReviewCommentPreview" ADD CONSTRAINT "ReviewCommentPreview_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
