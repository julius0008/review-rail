-- CreateTable
CREATE TABLE "ReviewRun" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "headSha" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewFinding" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "actionableFix" TEXT,
    "source" TEXT NOT NULL,
    "publish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewFinding_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReviewFinding" ADD CONSTRAINT "ReviewFinding_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
