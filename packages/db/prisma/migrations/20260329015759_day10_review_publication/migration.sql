-- CreateTable
CREATE TABLE "ReviewPublication" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "githubReviewId" INTEGER,
    "status" TEXT NOT NULL,
    "body" TEXT,
    "submittedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewPublication_reviewRunId_idx" ON "ReviewPublication"("reviewRunId");

-- AddForeignKey
ALTER TABLE "ReviewPublication" ADD CONSTRAINT "ReviewPublication_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
