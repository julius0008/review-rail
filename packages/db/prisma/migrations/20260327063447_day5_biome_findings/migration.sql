/*
  Warnings:

  - A unique constraint covering the columns `[repoId,prNumber,headSha]` on the table `ReviewRun` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ReviewFinding" ADD COLUMN     "ruleId" TEXT;

-- AlterTable
ALTER TABLE "ReviewRun" ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "ChangedFile_reviewRunId_idx" ON "ChangedFile"("reviewRunId");

-- CreateIndex
CREATE INDEX "ReviewFinding_reviewRunId_idx" ON "ReviewFinding"("reviewRunId");

-- CreateIndex
CREATE INDEX "ReviewFinding_path_idx" ON "ReviewFinding"("path");

-- CreateIndex
CREATE INDEX "ReviewRun_createdAt_idx" ON "ReviewRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRun_repoId_prNumber_headSha_key" ON "ReviewRun"("repoId", "prNumber", "headSha");
